import { Request, Response } from "express";
import { cache } from "../server";
import {fromUrl, TypedArray} from "geotiff";
import { computeNDVI, getMeanNDVI, getMedianNDVI, getTokenCollection, isGoodPixel, lonLatToPixel, upscaleSCL } from "../utils/generalUtils";


export const pointNDVIController = async (req: Request, res: Response) => {
  try {
    const { cog_red, cog_nir, cog_scl, lat, lon } = req.query;

    if (!cog_red || !cog_nir || !cog_scl || !lat || !lon) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const cacheKey = `${cog_red}_${cog_nir}_${cog_scl}_${lat}_${lon}`;

    if (cache.getCache(cacheKey)) {
      return res.json({
        ...cache.getCache(cacheKey),
        cache: "hit"
      });
    }

    // --- Sign URLs ---
    const token = await getTokenCollection()
    console.log("token")
    console.log(token)
    const cog_red_signed = `${cog_red}?${token}`
    const cog_nir_signed = `${cog_nir}?${token}`
    const cog_scl_signed = `${cog_scl}?${token}`

    // --- Load COGs ---
    const redTiff = await fromUrl(cog_red_signed as string);
    const nirTiff = await fromUrl(cog_nir_signed as string);
    const sclTiff = await fromUrl(cog_scl_signed as string);

    const red = await redTiff.getImage();
    const nir = await nirTiff.getImage();
    const scl = await sclTiff.getImage();

    // ---- Convert lat/lon -> pixel coords ----
    const [x, y] = lonLatToPixel(red, Number(lon), Number(lat));

    if(x === undefined || y === undefined ){
        return res.json({
            meanNDVI: null,
            medianNDVI: null,
            valid: false,
            validity: 0,
            reason: "Pixels are undefined",
            cache: "miss"
        })
    }
    let window = [x, y, x + 1, y + 1]
    // ---- Read small window (1 pixel for point) ----
    const redVal = await red.readRasters({ window });
    const nirVal = await nir.readRasters({ window });
    const sclVal = await scl.readRasters({ window });
    if(!redVal || !nirVal || !sclVal){
        return res.json({
            meanNDVI: null,
            medianNDVI: null,
            valid: false,
            validity: 0,
            reason: "Rasters are undefined",
            cache: "miss"
        })
    }
    // --- Upscale SCL asset
    let upscaledSCL: Uint8Array<ArrayBuffer> = upscaleSCL(
        sclVal[0] as TypedArray, 
        sclVal.width,
        sclVal.height,
        redVal.width,
        redVal.height
    )
    // --- Mask using SCL ---
    let validPixels = 0
    let notValidPixels = 0
    upscaledSCL.forEach((scl)=>{
        if(isGoodPixel(scl)){
            ++validPixels
        } else {
            ++notValidPixels
        }
    })
    
    const validity = (validPixels / upscaledSCL.length) 
    if (validPixels == 0) {
        return res.json({
            meanNDVI: null,
            medianNDVI: null,
            validity: 0,
            reason: "Cloud or shadow mask",
            cache: "miss"
        });
    }
    // --- Compute NDVI ---
    const ndviArray = computeNDVI(redVal[0] as TypedArray, nirVal[0] as TypedArray, sclVal[0] as TypedArray);
    const meanNDVI = getMeanNDVI(ndviArray)
    const medianNDVI = getMedianNDVI(ndviArray)
    
    const result = {
        meanNDVI: meanNDVI,
        medianNDVI: medianNDVI,
        valid: true,
        validity: validity,
        cache: "miss"
    };

    cache.setCache(cacheKey, result);

    return res.json(result);

  } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
  }
}