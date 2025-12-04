export enum EStacBands {
  nir = "B08",
  red = "B04",
  scl = "SCL"
}

export interface ITokenCollection {
  "msft:expiry": string;
  token: string;
}

export enum ESTACURLS {
  collectionTokenURL = "https://planetarycomputer.microsoft.com/api/sas/v1/token/",
}

export enum ESTACCollections {
  Sentinel2l2a = "sentinel-2-l2a",
}
