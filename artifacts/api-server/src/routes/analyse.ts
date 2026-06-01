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

  const prompt = `You are an expert PGA-level golf coach analysing a real golf swing from video frames. You are looking at 6 frames extracted from the swing sequence.

Analyse what you can ACTUALLY SEE in the images:

Frame 1: Address position — check posture, spine angle, knee flex, ball position, grip
Frame 2: Takeaway — check club path, wrist set, shoulder turn initiation
Frame 3: Mid backswing — check rotation, plane, arm position
Frame 4: Top of backswing — check shoulder turn, hip resistance, club position
Frame 5: Impact — check weight transfer, hip clearance, head position, club face
Frame 6: Follow through — check extension, balance, finish position

Be BRUTALLY honest. If the swing looks amateur, score it 30-50. If it looks professional, score it 85-95. Do not give every swing 67. Look at the actual images and judge what you see.

The golfer's stated average score is ${averageScore}. Use this to calibrate — someone who shoots 100+ should score 25-45, a scratch golfer 80-95.

Golfer profile (use to personalise feedback only, not to inflate scores):
- Years playing: ${years}
- Goal: ${goal}
- Coaching style preference: ${coach}

Score these 11 variables based strictly on what you observe in the frames:
Backswing Plane, Downswing Plane, Hip Rotation, Shoulder Turn, Weight Transfer, Club Face at Impact, Ball Position, Grip, Follow Through, Head Stability, Tempo & Rhythm.

For handicapEstimate, derive from the swing quality you actually see:
- Tour professional: "+4 to +6"
- Scratch golfer: "0 to 2"
- Single figure (1-9): "3 to 9"
- Mid handicap (10-18): "10 to 18"
- High handicap (19-28): "19 to 28"
- Beginner (28+): "28 to 36"

Tailor the coachMessage tone to a ${coach} coaching style.

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
  "biggestKillerDesc": "<2-sentence explanation of this fault and its impact on ball flight>",
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
