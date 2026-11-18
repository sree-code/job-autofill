import * as blob from "@vercel/blob";
import { makeHandlers } from "../lib/blob-handlers.mjs";
const h = makeHandlers(blob);
export default (req, res) => h.events(req, res);
