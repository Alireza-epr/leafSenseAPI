import { Request, Response } from "express";
import { cache } from "../server";
import {fromUrl, TypedArray} from "geotiff";
import { computeNDVI, getMeanNDVI, getMedianNDVI, getTokenCollection, isGeoJSONValid, isGoodPixel, lonLatToPixel, upscaleSCL } from "../utils/generalUtils";


export const zonalNDVIController = async (req: Request, res: Response) => {
    
  try {
    if(!req.body){
        return res.status(400).json({ error: "Missing body" });
    }

    const { cog_red, cog_nir, cog_scl, geojson } = req.body;

    if (!cog_red || !cog_nir || !cog_scl || !geojson) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const cacheKey = `${cog_red}_${cog_nir}_${cog_scl}_${geojson}`;

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
    if(!isGeoJSONValid(geojson)){
      return res.status(400).json({ error: "GeoJSON parameter is not valid" });  
    }

    const [ [lon1, lat1], [lon2, lat2], [lon3, lat3], [lon4, lat4] ] = geojson 
    const [x1, y1] = lonLatToPixel(red, Number(lon1), Number(lat1));
    const [x2, y2] = lonLatToPixel(red, Number(lon2), Number(lat2));
    const [x3, y3] = lonLatToPixel(red, Number(lon3), Number(lat3));
    const [x4, y4] = lonLatToPixel(red, Number(lon4), Number(lat4));

    if(  
        x1 === undefined || y1 === undefined ||
        x2 === undefined || y2 === undefined ||
        x3 === undefined || y3 === undefined ||
        x4 === undefined || y4 === undefined
    ){
        return res.json({
            meanNDVI: null,
            medianNDVI: null,
            valid: false,
            validity: 0,
            reason: "Pixels are undefined",
            cache: "miss"
        })
    }

    const minX = Math.min(x1, x2, x3, x4)
    const maxX = Math.max(x1, x2, x3, x4)
    const minY = Math.min(y1, y2, y3, y4)
    const maxY = Math.max(y1, y2, y3, y4)

    let window = [minX, minY, maxX, maxY]
    // ---- Read window ----
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
    
    // --- Upscale SCL asset ----
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
            valid: false,
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