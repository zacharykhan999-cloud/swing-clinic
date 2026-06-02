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

  const prompt = `You are a PGA-level golf coach analysing a real swing from 6 extracted video frames. Study each frame carefully.
Frame 1 = Address/setup. Frame 2 = Early takeaway. Frame 3 = Mid backswing. Frame 4 = Top of backswing. Frame 5 = Impact zone. Frame 6 = Follow through.
Look at the actual images and assess:

Spine angle and posture at address
Club path direction in the takeaway
Amount of shoulder and hip rotation
Club position at the top
Hip clearance and weight shift at impact
Balance and extension in follow through

SCORING RULES — you must follow these exactly:

If the swing looks professional (smooth, full rotation, on plane): score 85-95
Single figure handicap swing: score 72-84
Mid handicap swing: score 55-71
High handicap swing: score 38-54
Beginner swing (over the top, poor rotation, losing balance): score 25-37

The golfer states their average score is ${averageScore}. Weight this heavily in your scoring. Do NOT give every swing 67. Vary the scores based on what you actually see.

Golfer profile (personalise feedback and tone only):
- Years playing: ${years}
- Goal: ${goal}
- Coaching style: ${coach}

For handicapEstimate, derive from the swing quality you actually see:
- Tour professional: "+4 to +6"
- Scratch golfer: "0 to 2"
- Single figure (1-9): "3 to 9"
- Mid handicap (10-18): "10 to 18"
- High handicap (19-28): "19 to 28"
- Beginner (28+): "28 to 36"

Return only valid JSON with no markdown or explanation:
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
  "biggestKillerDesc": "<2-sentence explanation of this fault and its impact on ball flight>",
  "potentialGain": "<e.g. '3-5 shots per round' — how many shots fixing this fault could save>",
  "drills": [
    { "name": "<drill name>", "desc": "<clear step-by-step instructions>", "reps": "<e.g. 20 reps · Daily>" },
    { "name": "<drill name>", "desc": "<clear step-by-step instructions>", "reps": "<e.g. 15 swings · 3×/week>" }
  ],
  "coachMessage": "<personalised 2-3 sentence message in the requested coaching style, referencing specific things you saw>",
  "handicapEstimate": {
    "range": "<range string>",
    "reason": "<one sentence referencing specific swing characteristics you observed>"
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
