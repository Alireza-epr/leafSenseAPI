import { CacheHandler } from "../utils/generalUtils"

declare global {
  namespace Express {
    interface Request {
      cache?: CacheHandler
    }
  }
}