import { GeoTIFFImage, ReadRasterResult, TypedArray, fromUrl} from "geotiff"
import { ESTACCollections, ESTACURLS, ITokenCollection, TPercentage } from "../types/generalTypes"
import proj4 from "proj4";

export class CacheHandler {

    private _cache = new Map<string, any>()

    constructor() {

    }

    private _generateCacheKey (a_Params: { [key: string]: any}) {
        const sortedParams = Object.keys(a_Params).sort()

        let key: string[] = []

        for(const paramKey of sortedParams ){
            let paramValue = ''
            if(Array.isArray(a_Params[paramKey]) || typeof a_Params[paramKey] === "object"){
                paramValue = JSON.stringify(a_Params[paramKey])
            } else {
                paramValue = `${a_Params[paramKey]}`
            }
            
            key.push(`${paramKey}=${paramValue}`)
        }

        return key.join("&")
    }

    setCache (a_Key: any, a_Value: any) {
        const key = this._generateCacheKey(a_Key)
        this._cache.set(key, a_Value)
    }

    getCache (a_Key: any) {
        const key = this._generateCacheKey(a_Key)
        if(this._cache.has(key)){
            return this._cache.get(key)
        }
    }

}

export const lonLatToPixel = (image: GeoTIFFImage, lon: number, lat: number): [number, number] => {
  // Get the image CRS EPSG code from geoKeys
  const geoKeys = image.getGeoKeys();
  const epsgCode = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey;
  const imageCRS = `EPSG:${epsgCode}`;

  // Reproject lon/lat (EPSG:4326) → image CRS
  const [xProjected, yProjected] = proj4('EPSG:4326', imageCRS, [lon, lat]);

  // Get image geotransform: origin and pixel resolution
  const [originX, originY] = image.getOrigin();        // top-left corner
  const [pixelWidth, pixelHeight] = image.getResolution(); // pixel size (meters)

  if(!originX || !originY){
    throw new Error("Failed to get image origin")
  }
  if(!pixelWidth || !pixelHeight){
    throw new Error("Failed to get image resolution")
  }
  // Convert projected coordinates → pixel indices
  const px = Math.floor((xProjected - originX) / pixelWidth);
  const py = Math.floor((originY - yProjected) / Math.abs(pixelHeight));

  return [px, py];
};

export const isTokenExpired = (a_Token: ITokenCollection): boolean => {
  const expiredDateUTCString = a_Token["msft:expiry"]; // '2025-11-26T11:08:13Z'
  const expiredDateUTC = new Date(expiredDateUTCString).getTime(); // ms since 1970
  const nowDateUTC = Date.now(); // ms since 1970

  return nowDateUTC >= expiredDateUTC;
};

export const getFeatureToken = async (
  a_Id: string,
): Promise<ITokenCollection | null> => {
  const resp = await fetch(`${ESTACURLS.collectionTokenURL}${a_Id}`);
  if (!resp.ok) {
    const respJSON = await resp.json();
    console.error("Failed to get the collection token: ");
    console.error(respJSON);
    return null;
  }
  const respJSON = await resp.json();
  return respJSON;
};

export let tokenCollection: ITokenCollection | null = null;
export let tokenPromise: Promise<ITokenCollection> | null = null;

export const getTokenCollection = async () => {
    if (tokenCollection && !isTokenExpired(tokenCollection)) {
      return tokenCollection.token;
    }

    // If another request is already fetching a token, wait for it
    if (tokenPromise) return (await tokenPromise).token;

    tokenPromise = getFeatureToken(ESTACCollections.Sentinel2l2a)
    .then((token) => {
        if (!token) throw new Error("Failed to fetch token");
        tokenCollection = token;
        tokenPromise = null;
        return token;
    })
    .catch((err) => {
        tokenPromise = null;
        throw err;
    });

    const token = await tokenPromise;
    return token.token;
};

export const toFloat32Array = (a_Arr: TypedArray): Float32Array => {
  if (a_Arr instanceof Float32Array) return a_Arr;
  return new Float32Array(a_Arr);
};

export const computeNDVI = (
  a_Red: TypedArray,
  a_Nir: TypedArray,
  a_SCL: TypedArray,
): Float32Array => {
  const r = toFloat32Array(a_Red);
  const n = toFloat32Array(a_Nir);
  const scl = a_SCL;

  const ndvi = new Float32Array(r.length);

  for (let i = 0; i < r.length; i++) {
    const ni = n[i];
    const ri = r[i];
    const si = scl[i];
    if (ni === undefined || ri === undefined || si === undefined) {
        continue;
    }
    if (isGoodPixel(si)) {
        ndvi[i] = (ni - ri) / (ni + ri); // ni and ri are now number
    } else {
        ndvi[i] = NaN;
    }
  }

  return ndvi;
};

export const getMeanNDVI = (
  a_NDVI: Float32Array<ArrayBufferLike>,
) => {
  let sum = 0;
  let count = 0;

  for (const n of a_NDVI) {
    if (!isNaN(n) && isFinite(n)) {
      sum += n; 
      ++count;
    }
  }

  return count > 0
    ? sum / count
    : null;
}

export const getMedianNDVI = (
  a_NDVI: Float32Array<ArrayBufferLike>,
) => {
  const sorted = Float32Array.from(a_NDVI).sort((a, b) => a - b);
  const len = sorted.length
  if(len == 1){
    return sorted[0] as number
  }
  const mid = Math.floor(len / 2);
  if(len % 2){
    // Even
    return ( (sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  } else {
    //Odd
    return sorted[mid] as number;
  }

}

export const isGoodPixel = (a_Number: number) => {
    const bad = new Set([3, 6, 9])
    return !bad.has( a_Number )
}

export const getUpscaledSCL = (scl: number | TypedArray, sclWidth: number, sclHeight: number, targetWidth: number, targetHeight: number) => {
  const out = new Uint8Array(targetWidth * targetHeight);

  // Compute scale ratios between target (red) and source (scl)
  const scaleX = targetWidth / sclWidth;    // e.g., 2/1 = 2
  const scaleY = targetHeight / sclHeight;  // e.g., 3/2 = 1.5

  for (let y = 0; y < targetHeight; y++) {
    // Map high-res row back to low-res SCL row (nearest neighbor)
    // Example: red rows 0,1,2 → scl rows 0,1,1
    const srcY = Math.min(Math.floor(y / scaleY), sclHeight - 1);

    for (let x = 0; x < targetWidth; x++) {
      // Map high-res column back to low-res SCL column
      // Example: red cols 0,1 → scl col 0
      const srcX = Math.min(Math.floor(x / scaleX), sclWidth - 1);

      // Index in the source SCL array
      const srcIndex = srcY * sclWidth + srcX;

      // Index in the output array
      const dstIndex = y * targetWidth + x;

      // Copy nearest SCL pixel
      out[dstIndex] = scl[srcIndex];
    }
  }

  return out;
}

export const isGeoJSONValid = (a_Value: any) => {
  /* 
  [
		[7.464334235846994, 51.36640233387978],   
		[7.466235210810565, 51.36640233387978],   
		[7.466235210810565, 51.36751084196721],   
		[7.464334235846994, 51.36751084196721],
    [7.464334235846994, 51.36640233387978], 
	]
  */

  if(!Array.isArray(a_Value)){
    return false
  }

  if(a_Value.length !== 5){
    return false
  }

  for(const c of a_Value){
    if(!Array.isArray(c)){
      return false
    }
    if(c.length !== 2){
      return false
    }
    if(c.some( p => isNaN(p) )){
      return false
    }
  }

  return true

}

export const getImages = async (a_Red: string, a_Nir: string, a_SCL: string) => {
  // --- Sign URLs ---
  const token = await getTokenCollection()
  const cog_red_signed = `${a_Red}?${token}`
  const cog_nir_signed = `${a_Nir}?${token}`
  const cog_scl_signed = `${a_SCL}?${token}`

  // --- Load COGs ---
  const redTiff = await fromUrl(cog_red_signed as string);
  const nirTiff = await fromUrl(cog_nir_signed as string);
  const sclTiff = await fromUrl(cog_scl_signed as string);

  const red = await redTiff.getImage();
  const nir = await nirTiff.getImage();
  const scl = await sclTiff.getImage();

  return { red, nir, scl }
}

export const getWindow = (a_GeoJSON: any,a_Red: GeoTIFFImage ) => {
  // ---- Convert lat/lon -> pixel coords ----
  if(!isGeoJSONValid(a_GeoJSON)){
    throw new Error("GeoJSON parameter is not valid") 
  }

  const [ [lon1, lat1], [lon2, lat2], [lon3, lat3], [lon4, lat4] ] = a_GeoJSON 
  const [x1, y1] = lonLatToPixel(a_Red, Number(lon1), Number(lat1));
  const [x2, y2] = lonLatToPixel(a_Red, Number(lon2), Number(lat2));
  const [x3, y3] = lonLatToPixel(a_Red, Number(lon3), Number(lat3));
  const [x4, y4] = lonLatToPixel(a_Red, Number(lon4), Number(lat4));

  if(  
      x1 === undefined || y1 === undefined ||
      x2 === undefined || y2 === undefined ||
      x3 === undefined || y3 === undefined ||
      x4 === undefined || y4 === undefined
  ){
    throw new Error("Pixels are undefined") 
  }

  const minX = Math.min(x1, x2, x3, x4)
  const maxX = Math.max(x1, x2, x3, x4)
  const minY = Math.min(y1, y2, y3, y4)
  const maxY = Math.max(y1, y2, y3, y4)

  let window = [minX, minY, maxX, maxY]

  return window
}

export const getSmallWindow = (a_Lon: number, a_Lat: number, a_Red: GeoTIFFImage ) => {
  // ---- Convert lat/lon -> pixel coords ----
  const [x, y] = lonLatToPixel(a_Red, Number(a_Lon), Number(a_Lat));

  if(x === undefined || y === undefined ){
    throw new Error("Pixels are undefined")
  }

  let window = [x, y, x + 1, y + 1]

  return window
}

export const getRasterValues = async (a_Red: GeoTIFFImage, a_Nir: GeoTIFFImage, a_SCL: GeoTIFFImage, a_Window: number[]) => {
  // ---- Read window ----
  const redVal = await a_Red.readRasters({ window: a_Window });
  const nirVal = await a_Nir.readRasters({ window: a_Window });
  const sclVal = await a_SCL.readRasters({ window: a_Window });
  if(!redVal || !nirVal || !sclVal){
    throw new Error("Rasters are undefined")
  }

  return { redVal, nirVal, sclVal }
}

export const getValidity = (a_UpscaledSCL: Uint8Array<ArrayBuffer>) : TPercentage => {
  // --- Mask using SCL ---
  let validPixels = 0
  let notValidPixels = 0
  a_UpscaledSCL.forEach((scl)=>{
    if(isGoodPixel(scl)){
      ++validPixels
    } else {
      ++notValidPixels
    }
  })
  
  if (validPixels == 0) {
    throw new Error("Cloud or shadow mask/ No valid pixel")
  }

  const validity = (validPixels / a_UpscaledSCL.length) * 100

  return `${validity}%`

}

export const getNDVI = (a_RedVal: ReadRasterResult, a_NirVal: ReadRasterResult, a_SCLVal: ReadRasterResult ) => {
  const ndviArray = computeNDVI(a_RedVal[0] as TypedArray, a_NirVal[0] as TypedArray, a_SCLVal[0] as TypedArray);
  const meanNDVI = getMeanNDVI(ndviArray)
  const medianNDVI = getMedianNDVI(ndviArray)

  return { meanNDVI, medianNDVI }
}

export const computeNDVIFromImages = async (a_Red: GeoTIFFImage, a_Nir: GeoTIFFImage, a_SCL: GeoTIFFImage, a_Window: number[]) => {
  const {redVal, nirVal, sclVal} = await getRasterValues(
    a_Red, 
    a_Nir, 
    a_SCL, 
    a_Window
  )
  
  const upscaledSCL: Uint8Array<ArrayBuffer> = getUpscaledSCL(
      sclVal[0] as TypedArray, 
      sclVal.width,
      sclVal.height,
      redVal.width,
      redVal.height
  )
  
  const validity = getValidity(upscaledSCL)

  const { meanNDVI, medianNDVI } = getNDVI(redVal, nirVal, sclVal)

  return { meanNDVI, medianNDVI, validity }
}