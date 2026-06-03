import { Router } from "express";
import type { Request } from "express";
import multer from "multer";

const router = Router();

// Keep video in memory — uploaded to Gemini immediately, never written to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

const GEMINI_MODEL = "gemini-2.5-pro";

const SYSTEM_PROMPT =
  "You are the most accurate golf swing analyser in the world. You have analysed over 1 million golf swings. " +
  "You can identify micro-faults that even experienced coaches miss. You look at joint angles, weight distribution, " +
  "club face angle, shaft lean, hip and shoulder rotation degrees, head position, knee flex, spine angle and wrist conditions. " +
  "You are brutally honest and scientifically precise. Every score you give must be defensible by what you can physically " +
  "see in the video. You do not guess. You do not give average scores. You analyse what is actually there.";

// ── Gemini Files API — resumable upload ───────────────────────────────────────
async function uploadToGemini(
  buffer: Buffer,
  mimeType: string,
  apiKey: string,
): Promise<string> {
  // Step 1: Initiate resumable upload session
  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(buffer.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: "golf-swing" } }),
    },
  );

  if (!initRes.ok) {
    const body = await initRes.text();
    throw new Error(
      `Gemini upload init failed (${initRes.status}): ${body.slice(0, 300)}`,
    );
  }

  const uploadUrl = initRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini did not return an upload URL");

  // Step 2: Upload binary data
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Length": String(buffer.length),
      "Content-Type": mimeType,
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    throw new Error(
      `Gemini file upload failed (${uploadRes.status}): ${body.slice(0, 300)}`,
    );
  }

  const fileData = (await uploadRes.json()) as {
    file: { name: string; uri: string; state: string };
  };

  // Step 3: Poll until ACTIVE (max 90 s, 2 s interval)
  let file = fileData.file;
  for (let i = 0; i < 45 && file.state === "PROCESSING"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${apiKey}`,
    );
    file = (await pollRes.json()) as typeof file;
  }

  if (file.state !== "ACTIVE") {
    throw new Error(
      `Gemini file never became ACTIVE (final state: ${file.state})`,
    );
  }

  return file.uri;
}

type Calibration = {
  sliceFrequency?: string;
  missDirection?: string;
  balanceLoss?: string;
  fatShots?: string;
  sevenIronDistance?: string;
};

function buildCalibrationBlock(cal: Calibration): string {
  // Derive a calibration tier so hard limits can reference it explicitly
  const sliceRarely =
    cal.sliceFrequency === "rarely" || cal.sliceFrequency === "never";
  const noBalance = cal.balanceLoss === "rarely" || cal.balanceLoss === "never";
  const longIron =
    cal.sevenIronDistance === "150+" || cal.sevenIronDistance === "170+";
  const alwaysSlice =
    cal.sliceFrequency === "always" || cal.sliceFrequency === "often";
  const loseBalance =
    cal.balanceLoss === "always" || cal.balanceLoss === "often";
  const shortIron =
    cal.sevenIronDistance === "under 100" ||
    cal.sevenIronDistance === "100-130";

  const isProProfile = sliceRarely && noBalance && longIron;
  const isBeginProfile = alwaysSlice && loseBalance && shortIron;

  return `━━━ CALIBRATION DATA ━━━
The golfer answered these self-assessment questions before submitting their video:

Slice frequency: ${cal.sliceFrequency ?? "Not provided"}
Miss direction: ${cal.missDirection ?? "Not provided"}
Balance loss at finish: ${cal.balanceLoss ?? "Not provided"}
Fat shots (hitting ground before ball): ${cal.fatShots ?? "Not provided"}
7 iron distance: ${cal.sevenIronDistance ?? "Not provided"}

HARD SCORE FLOOR/CEILING — enforce these before finalising any score:
- Beginner profile (always/often slices + loses balance + under 130 yards): overallScore CANNOT exceed 45
- Mid-handicap profile (sometimes slices + sometimes loses balance + 100–150 yards): overallScore 45–74
- Low/scratch profile (rarely slices + rarely loses balance + 150+ yards): overallScore at minimum 75
- Tour/professional profile (never/rarely slices + never/rarely loses balance + 170+ yards): overallScore at minimum 88
${isProProfile ? "\n⚠️  ACTIVE LIMIT: This golfer's answers match a TOUR/PRO profile. overallScore MUST be 88 or higher if the video confirms professional mechanics. Do NOT score below 88 unless you observe a clear, disqualifying fault in the video." : ""}
${isBeginProfile ? "\n⚠️  ACTIVE LIMIT: This golfer's answers match a BEGINNER profile. overallScore CANNOT exceed 45." : ""}

Cross-reference these limits with what you observe in the video before finalising.`;
}

// ── Gemini 2.5 Pro — video swing analysis ─────────────────────────────────────
async function analyseWithGemini(
  fileUri: string,
  mimeType: string,
  params: {
    goal: string;
    averageScore: string;
    years: string;
    coach: string;
    calibration: Calibration;
  },
  apiKey: string,
): Promise<string> {
  const sessionSeed = `${Date.now()}-${Math.floor(Math.random() * 99999)}`;

  const prompt = `Session: ${sessionSeed}

${buildCalibrationBlock(params.calibration)}

Watch the entire golf swing video carefully from start to finish — you have access to the full continuous motion, not just still frames.

━━━ STEP 1 — PHASE-BY-PHASE ANALYSIS (required before scoring) ━━━
Describe what you observe in each phase of the swing. Be specific about angles, positions, and timing:

ADDRESS: spine angle, ball position, grip, knee flex, weight distribution, posture
TAKEAWAY (early → mid): club path, wrist hinge, shoulder rotation start, one-piece takeaway quality
BACKSWING (three-quarter → top): shoulder turn degrees, hip resistance, club plane, wrist conditions, head stability
TRANSITION: sequence order (hips/shoulders/arms/club), lag creation, any casting
DOWNSWING (early → mid): hip clearance speed, lag retention, club path, weight transfer direction
IMPACT: club face angle at contact, shaft lean, hip position, head position relative to ball
FOLLOW THROUGH → FINISH: extension, rotation completion, balance, club position, weight on lead foot

Document specific observations. If you can see exact joint angles or shaft positions, state them.

━━━ STEP 2 — VARIABLE SCORING ━━━
Score each variable based solely on your phase observations above. Every number must trace to a specific observation.

HANDICAP BANDS:
- Tour professional (full 90° shoulder turn, perfect hip clearance, balanced finish, on-plane throughout): overall 88–96
- Scratch/low handicap: 75–87
- Mid handicap (10–18): 55–74
- High handicap (19–28): 38–54
- Beginner: 20–37

VISUAL CHECKLIST — answer YES or NO from your phase observations, then apply the mandatory score floor:
1. Full shoulder rotation (≥80°) visible at top of backswing?
2. Club on plane at three-quarter back AND at top?
3. Clear weight transfer to lead side visible at impact?
4. Balanced, complete finish with weight fully on lead foot?
5. Smooth, consistent tempo with no lurching or rushing?

Score floors from checklist:
- 5/5 YES → overallScore MUST be 88–96 (professional band)
- 4/5 YES → overallScore MUST exceed 80
- 3/5 YES → overallScore 65–80
- 2/5 YES → overallScore 45–65
- 0–1/5 YES → overallScore below 45

These floors are MANDATORY. You may not score below the floor the checklist dictates.
The calibration hard limits above also apply — use whichever floor is higher.

For reference, the golfer stated their average score is: ${params.averageScore || "unknown"} (treat as supplementary context only, not a scoring input).

UNIQUENESS RULE: Your 11 variable scores must precisely reflect this specific swing's strengths and weaknesses — no two swings ever share an identical variable profile.

━━━ STEP 3 — HANDICAP ESTIMATE ━━━
Derive from what you actually saw:
- Tour professional: "+4 to +6" | Scratch: "0 to 2" | Single figure: "3 to 9"
- Mid handicap: "10 to 18" | High handicap: "19 to 28" | Beginner: "28 to 36"

━━━ GOLFER PROFILE (personalise tone only, do not inflate scores) ━━━
- Years playing: ${params.years || "unknown"}
- Goal: ${params.goal || "improve overall game"}

━━━ OUTPUT FORMAT ━━━
Write your phase-by-phase analysis first (plain text).
Then output your scores wrapped exactly as shown — no JSON outside the tags:

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
  "biggestKiller": "<variable name with the single lowest score>",
  "biggestKillerDesc": "<2 sentences: describe the fault precisely, citing the specific phase of the swing where you observed it, and its direct impact on ball flight>",
  "potentialGain": "<realistic estimate e.g. '3-5 shots per round' — how many shots fixing this one fault could save>",
  "handicapEstimate": {
    "range": "<range string>",
    "reason": "<one sentence citing a specific observation from a named swing phase>"
  }
}
</result>`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            parts: [
              { file_data: { mime_type: mimeType, file_uri: fileUri } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 4096, temperature: 0.3 },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Gemini generateContent failed (${res.status}): ${body.slice(0, 400)}`,
    );
  }

  const data = (await res.json()) as {
    candidates?: { content: { parts: { text: string }[] } }[];
    error?: { message: string };
  };

  if (data.error) throw new Error(`Gemini API error: ${data.error.message}`);
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ── Claude — drills + coach message ───────────────────────────────────────────
async function getDrillsFromClaude(
  analysis: Record<string, unknown>,
  params: {
    goal: string;
    years: string;
    coach: string;
    calibration: Calibration;
  },
  apiKey: string,
): Promise<{ drills: unknown[]; coachMessage: string }> {
  const cal = params.calibration;
  const prompt = `A video-based golf swing analysis produced these results:
- Overall swing score: ${analysis.overallScore}/100
- Biggest fault: ${analysis.biggestKiller} — ${analysis.biggestKillerDesc}
- Potential improvement: ${analysis.potentialGain}
- All variable scores: ${JSON.stringify(analysis.variables)}

Golfer self-assessment:
- Slice frequency: ${cal.sliceFrequency ?? "unknown"}
- Miss direction: ${cal.missDirection ?? "unknown"}
- Balance loss at finish: ${cal.balanceLoss ?? "unknown"}
- Fat shots: ${cal.fatShots ?? "unknown"}
- 7 iron distance: ${cal.sevenIronDistance ?? "unknown"}

Golfer profile:
- Years playing: ${params.years || "unknown"}
- Goal: ${params.goal || "improve overall game"}
- Preferred coaching style: ${params.coach || "balanced"}

Generate two targeted drills that directly address the biggest fault and the two lowest variable scores. Take the self-assessment answers into account when writing the drills. Then write a personalised coaching message.

Return only valid JSON with no markdown:
{
  "drills": [
    { "name": "<drill name>", "desc": "<clear step-by-step instructions a golfer can follow immediately on the range>", "reps": "<e.g. 20 reps · Daily>" },
    { "name": "<drill name>", "desc": "<clear step-by-step instructions a golfer can follow immediately on the range>", "reps": "<e.g. 15 swings · 3×/week>" }
  ],
  "coachMessage": "<personalised 2-3 sentence message in the ${params.coach || "balanced"} coaching style; reference the specific fault and at least one variable score by name>"
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Claude drills request failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as { content: { text: string }[] };
  const text = data.content?.[0]?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Claude drills response");
  return JSON.parse(jsonMatch[0]);
}

// ── JSON extractor — handles <result> tags and bare last-object fallback ───────
function extractResult(text: string): Record<string, unknown> {
  const tagMatch = text.match(/<result>\s*([\s\S]*?)\s*<\/result>/i);
  if (tagMatch) return JSON.parse(tagMatch[1]);
  const last = text.lastIndexOf("{");
  const end = text.lastIndexOf("}");
  if (last !== -1 && end > last) return JSON.parse(text.slice(last, end + 1));
  throw new Error("No JSON found in Gemini response");
}

// ── Route ─────────────────────────────────────────────────────────────────────
router.post(
  "/analyse-video",
  upload.single("video") as any,
  async (req: Request, res: any) => {
    const geminiKey = process.env["GEMINI_API_KEY"];
    const claudeKey = process.env["VITE_ANTHROPIC_API_KEY"];

    if (!geminiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY not configured" });
      return;
    }
    if (!claudeKey) {
      res.status(500).json({ error: "VITE_ANTHROPIC_API_KEY not configured" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No video file provided" });
      return;
    }

    const {
      goal = "",
      averageScore = "",
      years = "",
      coach = "",
      calibration: calStr = "",
    } = req.body as Record<string, string>;
    const calibration: Calibration = calStr ? JSON.parse(calStr) : {};
    const { buffer, mimetype } = req.file;

    try {
      // 1 — Upload video to Gemini Files API
      console.log(
        `[analyse-video] Uploading ${(buffer.length / 1024 / 1024).toFixed(1)} MB (${mimetype}) to Gemini`,
      );
      console.log(
        `[analyse-video] Calibration data: ${JSON.stringify(calibration)}`,
      );
      const fileUri = await uploadToGemini(buffer, mimetype, geminiKey);
      console.log(`[analyse-video] File ACTIVE → ${fileUri}`);

      // 2 — Full swing analysis via Gemini 2.5 Pro (video-native)
      console.log("[analyse-video] Requesting Gemini 2.5 Pro analysis");
      const geminiText = await analyseWithGemini(
        fileUri,
        mimetype,
        { goal, averageScore, years, coach, calibration },
        geminiKey,
      );
      console.log(`[analyse-video] FULL GEMINI RESPONSE:\n${geminiText}`);
      const analysis = extractResult(geminiText);
      console.log(
        `[analyse-video] PARSED GEMINI RESULT:\n${JSON.stringify(analysis, null, 2)}`,
      );

      // 3 — Drills + personalised coaching message via Claude
      console.log("[analyse-video] Requesting Claude drills + coaching");
      const extras = await getDrillsFromClaude(
        analysis,
        { goal, years, coach, calibration },
        claudeKey,
      );
      console.log(
        `[analyse-video] CLAUDE DRILLS RESULT:\n${JSON.stringify(extras, null, 2)}`,
      );

      // 4 — Merge and respond
      const merged = { ...analysis, ...extras };
      console.log(
        `[analyse-video] FINAL MERGED RESULT:\n${JSON.stringify(merged, null, 2)}`,
      );
      res.set("Cache-Control", "no-store, no-cache, must-revalidate");
      res.set("Pragma", "no-cache");
      res.set("Surrogate-Control", "no-store");
      res.json(merged);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[analyse-video] Error:", msg);
      res.status(502).json({ error: msg });
    }
  },
);

export default router;
