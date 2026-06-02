import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY || "",
  });
});

export default router;
