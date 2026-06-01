import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.post("/analyse", async (req, res) => {
  const apiKey = process.env["VITE_ANTHROPIC_API_KEY"];
  if (!apiKey) {
    res.status(500).json({ error: "VITE_ANTHROPIC_API_KEY is not configured on the server." });
    return;
  }

  const { frames = [], goal, averageScore, years, coach } = req.body as {
    frames: string[];
    goal: string;
    averageScore: string;
    years: string;
    coach: string;
  };

  const imageContent = frames.map((b64: string) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: b64 },
  }));

  const prompt = `You are an expert golf coach and swing analyst. Analyse these frames extracted from a golfer's swing video.

Golfer profile:
- Stated average score per round: ${averageScore}
- Years playing: ${years}
- Goal: ${goal}
- Coaching style preference: ${coach}

SCORING CALIBRATION — this is your primary anchor:
Use the golfer's stated average score as your primary calibration. Their stated average is: ${averageScore}. Calibrate ALL variable scores around this. A golfer who shoots 100+ cannot have variables scoring above 55. A golfer who shoots 70-80 should have variables mostly 68-82. Then adjust up or down based on what you actually see in the frames.

Score ranges mapped to stated average:
- Stated average Under 70 (scratch/plus): overall score 85-95, variables mostly 80-95
- Stated average 70-80: overall score 72-84, variables mostly 68-82
- Stated average 80-90: overall score 55-71, variables mostly 50-70
- Stated average 90-100: overall score 38-54, variables mostly 35-55
- Stated average 100+ (Beginner): overall score 25-37, variables mostly 20-45

If the swing looks like a professional golfer — smooth tempo, full rotation, consistent plane, powerful impact position — score them in the 85-95 range. Do NOT give a professional swing a score under 80. Do NOT give a beginner swing a score over 55. The scores must be honest and reflect the actual quality visible in the frames.

Score these 11 variables: Backswing Plane, Downswing Plane, Hip Rotation, Shoulder Turn, Weight Transfer, Club Face at Impact, Ball Position, Grip, Follow Through, Head Stability, Tempo & Rhythm.

For handicapEstimate, use these ranges based on what you observe:
- Tour professional: "+4 to +6"
- Scratch golfer: "0 to 2"
- Single figure (1-9): "3 to 9"
- Mid handicap (10-18): "10 to 18"
- High handicap (19-28): "19 to 28"
- Beginner (28+): "28 to 36"

Tailor the coachMessage to a ${coach} coaching style.

Respond with ONLY valid JSON, no markdown, no explanation:
{
  "overallScore": <number 0-100>,
  "variables": {
    "Backswing Plane": <number>,
    "Downswing Plane": <number>,
    "Hip Rotation": <number>,
    "Shoulder Turn": <number>,
    "Weight Transfer": <number>,
    "Club Face at Impact": <number>,
    "Ball Position": <number>,
    "Grip": <number>,
    "Follow Through": <number>,
    "Head Stability": <number>,
    "Tempo & Rhythm": <number>
  },
  "biggestKiller": "<variable name with lowest score>",
  "biggestKillerDesc": "<2-sentence explanation of this fault and its impact>",
  "drills": [
    { "name": "<drill name>", "desc": "<clear instructions>", "reps": "<e.g. 20 reps · Daily>" },
    { "name": "<drill name>", "desc": "<clear instructions>", "reps": "<e.g. 15 swings · 3×/week>" }
  ],
  "coachMessage": "<personalised message in the requested coaching style>",
  "handicapEstimate": {
    "range": "<range string>",
    "reason": "<one sentence explanation>"
  }
}`;

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          ...imageContent,
          { type: "text", text: prompt },
        ],
      }],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    req.log.error({ status: anthropicRes.status, body: errText }, "Anthropic API error");
    res.status(502).json({ error: `Anthropic API error ${anthropicRes.status}: ${errText}` });
    return;
  }

  const anthropicData = await anthropicRes.json() as { content: { text: string }[] };
  const text = anthropicData.content?.[0]?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    req.log.error({ text }, "No JSON found in Anthropic response");
    res.status(502).json({ error: "No JSON in Anthropic response", raw: text.slice(0, 500) });
    return;
  }

  res.json(JSON.parse(jsonMatch[0]));
});

export default router;
