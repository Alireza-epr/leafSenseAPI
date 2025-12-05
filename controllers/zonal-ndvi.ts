import { Request, Response } from "express";
import { cache } from "../server";
import {TypedArray} from "geotiff";
import { getImages, getNDVI, getRasterValues, getValidity, getWindow, getUpscaledSCL, computeNDVIFromImages } from "../utils/generalUtils";
import { INDVIResp } from "../types/generalTypes";


export const zonalNDVIController = async (req: Request, res: Response) => {
  try {
    if(!req.body){
        throw new Error("Missing body")
    }

    const { cog_red, cog_nir, cog_scl, geojson } = req.body;

    if (!cog_red || !cog_nir || !cog_scl || !geojson) {
        throw new Error("Missing parameters")
    }

    const cacheKey = `${cog_red}_${cog_nir}_${cog_scl}_${JSON.stringify(geojson)}`;

    if (cache.getCache(cacheKey)) {
      return res.json({
        ...cache.getCache(cacheKey),
        cache: "hit"
      });
    }

    const {red, nir, scl} = await getImages(
        cog_red, cog_nir, cog_scl
    )

    const window = getWindow(geojson, red)
    
    const { meanNDVI, medianNDVI, validity } = await computeNDVIFromImages(red, nir, scl, window)
    
    const result: INDVIResp = {
        meanNDVI: meanNDVI,
        medianNDVI: medianNDVI,
        validity: validity,
        cache: "miss"
    };

    cache.setCache(cacheKey, result);

    return res.json(result);

  } catch (err: any) {
      console.error(err);
      const respError: INDVIResp = {
        meanNDVI: null,
        medianNDVI: null,
        validity: "0%",
        cache: "miss",
        reason: err?.message ?? "Server Error"
      }
      res.status(400).json(respError);
  }
}