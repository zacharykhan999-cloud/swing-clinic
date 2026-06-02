import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analyseRouter from "./analyse";
import configRouter from "./config";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/config", configRouter);
router.use(analyseRouter);

export default router;
