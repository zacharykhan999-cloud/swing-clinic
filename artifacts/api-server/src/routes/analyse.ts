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

You are analysing real golf swing frames. You must score what you actually see with no bias toward the middle.
STRICT SCORING RULES:

A tour professional swing (silky tempo, full 90 degree shoulder turn, perfect hip clearance, balanced finish, on-plane throughout) MUST score 88-96. If you see a professional-quality swing do not score it below 88 under any circumstances.
A scratch/low handicap swing: 75-87
Mid handicap (10-18): 55-74
High handicap (19-28): 38-54
Beginner: 20-37

CALIBRATION TEST — ask yourself before scoring:

Does this swing have full shoulder rotation? (+10 points)
Is the club on plane at the top? (+10 points)
Is there clear weight transfer to the lead side at impact? (+10 points)
Is the finish balanced and complete? (+10 points)
Is the tempo smooth and consistent? (+10 points)

If you answer yes to 4 or 5 of these, the score must be above 80. If yes to all 5 and the golfer is clearly a professional, score 88-96.
The golfer's stated average score is ${averageScore}. Weight this as 40% of the score, visual assessment as 60%.

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
