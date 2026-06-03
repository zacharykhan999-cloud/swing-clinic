import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analyseRouter from "./analyse";
import analyseVideoRouter from "./analyse-video";
import configRouter from "./config";
import whopWebhookRouter from "./whop-webhook";
import analysesRouter from "./analyses";
import profileRouter from "./profile";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/config", configRouter);
router.use(analyseRouter);
router.use(analyseVideoRouter);
router.use(whopWebhookRouter);
router.use(analysesRouter);
router.use(profileRouter);
router.use(adminRouter);

export default router;
