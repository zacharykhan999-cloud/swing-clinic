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

  const FRAME_LABELS = [
    "Address",
    "Early takeaway",
    "Mid takeaway",
    "Three quarter backswing",
    "Top of backswing",
    "Early downswing",
    "Mid downswing",
    "Impact",
    "Early follow through",
    "Mid follow through",
    "Full finish",
    "Face-on overview",
  ];

  // Interleave label text + image so Claude sees the label immediately before each frame
  const imageContent = frames.flatMap((b64: string, i: number) => [
    { type: "text", text: `Frame ${i + 1}: ${FRAME_LABELS[i] ?? `Frame ${i + 1}`}` },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
  ]);

  // Unique session seed so Claude cannot repeat a score from a prior request
  const sessionSeed = `${Date.now()}-${Math.floor(Math.random() * 99999)}`;

  const systemPrompt = `You are the most accurate golf swing analyser in the world. You have analysed over 1 million golf swings. You can identify micro-faults that even experienced coaches miss. You look at joint angles, weight distribution, club face angle, shaft lean, hip and shoulder rotation degrees, head position, knee flex, spine angle and wrist conditions. You are brutally honest and scientifically precise. Every score you give must be defensible by what you can physically see in the frames. You do not guess. You do not give average scores. You analyse what is actually there.`;

  const frameLabelsStr = FRAME_LABELS.slice(0, frames.length)
    .map((label, i) => `Frame ${i + 1} = ${label}`)
    .join(". ");

  const prompt = `Session: ${sessionSeed}

You are analysing ${frames.length} frames of a real golf swing. The frames are labelled:
${frameLabelsStr}.

━━━ STEP 1 — PER-FRAME ANALYSIS (required before scoring) ━━━
Before you assign any scores, you MUST analyse each frame individually. For every frame write:
- The exact frame label
- What you physically observe: joint angles, spine angle, club position, weight distribution, wrist conditions, knee flex, head position
- Any fault or strength you detect

Do not skip any frame. Do not summarise. Be precise and observational.

━━━ STEP 2 — SCORING RULES ━━━
Score based solely on what you observed above. Every score must be traceable to a specific observation you made.

BAND REFERENCE (use your per-frame notes to place the swing):
- Tour professional (silky tempo, full 90° shoulder turn, perfect hip clearance, balanced finish, on-plane throughout): 88–96
- Scratch/low handicap: 75–87
- Mid handicap (10–18): 55–74
- High handicap (19–28): 38–54
- Beginner: 20–37

CALIBRATION — answer from your frame notes before scoring:
1. Full shoulder rotation visible? (+10)
2. Club on plane at three-quarter backswing and top? (+10)
3. Clear weight transfer to lead side at impact? (+10)
4. Balanced, complete finish? (+10)
5. Smooth, consistent tempo throughout all frames? (+10)
Yes to 4–5 → overallScore must exceed 80. Yes to all 5 on a clearly professional swing → 88–96.

The golfer's stated average score is ${averageScore}. Weight this 40%, visual evidence 60%.

UNIQUENESS RULE: Every swing is physically different. Your 11 variable scores must reflect the specific strengths and faults you observed in this swing's frames. No two swings should share an identical variable profile.

━━━ STEP 3 — GOLFER PROFILE (personalise tone and drill selection only) ━━━
- Years playing: ${years}
- Goal: ${goal}
- Coaching style: ${coach}

━━━ STEP 4 — HANDICAP ESTIMATE ━━━
Derive from the swing quality you actually observed:
- Tour professional: "+4 to +6"
- Scratch golfer: "0 to 2"
- Single figure: "3 to 9"
- Mid handicap: "10 to 18"
- High handicap: "19 to 28"
- Beginner: "28 to 36"

━━━ OUTPUT FORMAT ━━━
Write your per-frame observations first (plain text, no JSON).
Then output your result wrapped exactly like this — no other braces outside the tags:

<result>
{
  "overallScore": <integer 0-100>,
  "variables": {
    "Backswing Plane": <integer>,
    "Downswing Plane": <integer>,
    "Hip Rotation": <integer>,
    "Shoulder Turn": <integer>,
    "Weight Transfer": <integer>,
    "Club Face at Impact": <integer>,
    "Ball Position": <integer>,
    "Grip": <integer>,
    "Follow Through": <integer>,
    "Head Stability": <integer>,
    "Tempo & Rhythm": <integer>
  },
  "biggestKiller": "<the variable name with the single lowest score>",
  "biggestKillerDesc": "<2 sentences: describe the fault precisely referencing the specific frame(s) where you saw it, and its direct impact on ball flight>",
  "potentialGain": "<e.g. '3-5 shots per round' — realistic estimate of how many shots fixing this one fault could save>",
  "drills": [
    { "name": "<drill name>", "desc": "<step-by-step instructions a golfer can follow immediately>", "reps": "<e.g. 20 reps · Daily>" },
    { "name": "<drill name>", "desc": "<step-by-step instructions a golfer can follow immediately>", "reps": "<e.g. 15 swings · 3×/week>" }
  ],
  "coachMessage": "<personalised 2-3 sentence message in the requested coaching style; reference at least one specific frame and what you saw there>",
  "handicapEstimate": {
    "range": "<range string>",
    "reason": "<one sentence citing a specific swing characteristic from a named frame>"
  }
}
</result>`;

  console.log(`[analyse] Sending ${frames.length} frame(s) to Anthropic (model: claude-sonnet-4-5)`);

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: [
          ...imageContent,
          { type: "text", text: prompt },
        ],
      }],
    }),
  });

  console.log(`[analyse] Anthropic response status: ${anthropicRes.status}`);

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    req.log.error({ status: anthropicRes.status, body: errText }, "Anthropic API error");
    console.error(`[analyse] Anthropic error body: ${errText}`);
    res.status(502).json({ error: `Anthropic API error ${anthropicRes.status}: ${errText}` });
    return;
  }

  const anthropicData = await anthropicRes.json() as {
    content: { text: string }[];
    usage?: Record<string, number>;
  };
  const text = anthropicData.content?.[0]?.text ?? "";
  console.log(`[analyse] Raw response (first 400 chars): ${text.slice(0, 400)}`);

  // Prefer the <result>...</result> block; fall back to last JSON object in the text
  let jsonStr: string | null = null;
  const tagMatch = text.match(/<result>\s*([\s\S]*?)\s*<\/result>/i);
  if (tagMatch) {
    jsonStr = tagMatch[1];
  } else {
    // Fallback: find the last { ... } block
    const lastBrace = text.lastIndexOf("{");
    const lastClose = text.lastIndexOf("}");
    if (lastBrace !== -1 && lastClose > lastBrace) {
      jsonStr = text.slice(lastBrace, lastClose + 1);
    }
  }

  if (!jsonStr) {
    req.log.error({ text }, "No JSON found in Anthropic response");
    console.error(`[analyse] No JSON found. Full text: ${text}`);
    res.status(502).json({ error: "No JSON in Anthropic response", raw: text.slice(0, 500) });
    return;
  }

  const result = JSON.parse(jsonStr);
  console.log(`[analyse] Parsed — overallScore: ${result.overallScore}, biggestKiller: ${result.biggestKiller}`);
  res.json(result);
});

export default router;
