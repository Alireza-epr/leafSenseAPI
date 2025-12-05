import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { CacheHandler } from "./utils/generalUtils";
import GeoTIFF from "geotiff";
import { pointNDVIController } from "./controllers/point-ndvi";
import { ITokenCollection } from "./types/generalTypes";
import { zonalNDVIController } from "./controllers/zonal-ndvi";
export const cache = new CacheHandler();

dotenv.config();

const app = express()

app.use(cors());
app.use(bodyParser.json());

const port = process.env.PORT || 8000

app.post("/point-ndvi", pointNDVIController );
 
app.post("/zonal-ndvi", zonalNDVIController);

app.listen(port, () => {
  console.log(`LeafSense API running on port ${port}`);
});