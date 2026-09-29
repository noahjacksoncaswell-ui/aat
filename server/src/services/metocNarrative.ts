import Anthropic from "@anthropic-ai/sdk";
import { env, isAnthropicConfigured } from "../config/env";
import type { DailyForecastEntry } from "./metoc";
import type { DayPovResult } from "./metocPov";

// v8.0 Section 5 - "AI-Generated Forecast Discussion." A genuinely new
// integration category for this codebase (Section 8 explicitly calls for
// building and testing this in isolation, fed sample data, before wiring it
// into the PDF pipeline - see server/scripts/testMetocNarrative.ts).
//
// The reference MEF's own Forecast Discussion (Appendix A of the v8.0
// directive) is passed as a style exemplar so the model matches its tone,
// structure (day-by-day progression, named weather features, explicit
// LWCCR references, a closing period-level summary), and technical
// vocabulary - not to be copied for content. The model is instructed to
// draw narrative content only from the real forecast data supplied in the
// prompt; it is never given room to invent conditions/numbers/events.
const REFERENCE_DISCUSSION_EXEMPLAR = `A complex weather pattern will impact the region through the
weekend. A cold and active pattern dominates the next few days, with a passing
winter system, varying cloud cover, and Arctic air mass influencing the Launch
Site. On Friday, November 29th, partly cloudy skies with scattered
stratocumulus clouds will prevail, posing little risk for precipitation. Highs
will be in the mid-20s with light north-northwest winds at 7-10 mph, with
persistent subfreezing conditions, resulting in a chilly afternoon. Visibility
will be good at 10 miles, and no significant upper-level wind shear. Despite a
relatively calm day, because low topped scattered stratocumulus and cumulus
clouds are expected, during the subfreezing front, there is an elevated risk of
temperature and cloud weather violations.

On Saturday, November 30, a passing winter system brings more dynamic and
unfavorable weather threatening the Launch Site with extensive cloudiness,
moderate precipitation from light snows, and worsened temperatures. Overcast
skies will prevail, with nimbostratus clouds lowering to 4,500 feet. Low cloud
bases and extensive coverage increase potential for trajectory interference.
The light to moderate snows expected throughout the day will present
substantial risk under the Precipitation Proximity Rule [LWCCR 11] and
Precipitation Flight Rule [LWCCR 12].

By Sunday, December 1, conditions improve as the system exits the region.
Skies will be fair, stratocumulus will dominate with scattered coverage and
bases as low as 1,300 feet, potentially causing localized concerns with the
Cloud Avoidance Rule [LWCCR 17].

The three-day launch period features persistent risks from subfreezing
temperatures, transient cloud structures, and snowfall associated with the
passing winter system. While winds and upper-level conditions remain largely
ideal throughout, conditions in the early weekend remain highly unfavorable
for launch, with lower risks expected by Sunday.`;

export interface NarrativeDayInput {
  date: string;
  label: string;
  tempHighF?: number;
  tempLowF?: number;
  windSpeedText?: string;
  windDirectionDeg?: string;
  precipitationProbabilityPct?: number;
  shortForecast?: string;
  detailedForecast?: string;
  povPercent: number;
  primaryConcerns: string[];
}

export function toNarrativeDayInput(day: DailyForecastEntry, pov: DayPovResult): NarrativeDayInput {
  return {
    date: day.date,
    label: day.label,
    tempHighF: day.tempHighF,
    tempLowF: day.tempLowF,
    windSpeedText: day.windSpeedText,
    windDirectionDeg: day.windDirectionDeg,
    precipitationProbabilityPct: day.precipitationProbabilityPct,
    shortForecast: day.shortForecast,
    detailedForecast: day.detailedForecast,
    povPercent: pov.povPercent,
    primaryConcerns: pov.primaryConcerns,
  };
}

function buildPrompt(days: NarrativeDayInput[], siteLabel: string): string {
  const dataBlock = days
    .map((d) => {
      const lines = [
        `${d.date} (${d.label}):`,
        `  High/Low: ${d.tempHighF ?? "N/A"}F / ${d.tempLowF ?? "N/A"}F`,
        `  Wind: ${d.windDirectionDeg ?? ""} ${d.windSpeedText ?? "N/A"}`,
        `  Precipitation Probability: ${d.precipitationProbabilityPct ?? "N/A"}%`,
        `  NWS Short Forecast: ${d.shortForecast ?? "N/A"}`,
        `  NWS Detailed Forecast: ${d.detailedForecast ?? "N/A"}`,
        `  Computed Probability of Violation: ${d.povPercent}%`,
        `  Computed Primary Concerns: ${d.primaryConcerns.length ? d.primaryConcerns.join(", ") : "None"}`,
      ];
      return lines.join("\n");
    })
    .join("\n\n");

  return `You are drafting the "Forecast Discussion" section of an unofficial Mission Execution Forecast (MEF) for ${siteLabel}, covering ${days.length} day(s).

STYLE EXEMPLAR (a real, human-authored MEF's Forecast Discussion - match its tone, technical vocabulary, day-by-day progression, and structure, including a closing period-level summary sentence. Do NOT copy its content, dates, or numbers - it is a style reference only):

"""
${REFERENCE_DISCUSSION_EXEMPLAR}
"""

REAL FORECAST DATA FOR THIS PERIOD (the ONLY source of facts you may use - do not invent any weather condition, number, or event not present here):

${dataBlock}

Write the Forecast Discussion now. Requirements:
- Cover the full period as one continuous narrative (not a bulleted list), progressing day by day in date order.
- Name specific weather features/systems where the data supports it (e.g. a passing system, a frontal boundary) - only if implied by the supplied short/detailed forecast text, never invented.
- Where a day's Computed Primary Concerns list is non-empty, work those LWCCR references into the relevant day's discussion naturally, in the format "[Rule Name] [LWCCR N]" exactly as given.
- Close with one summary sentence characterizing the period as a whole.
- Plain prose paragraphs, technical/meteorological register, no headers or bullet points, no markdown formatting.
- Base every claim strictly on the data provided above.`;
}

export class MetocNarrativeError extends Error {}

/**
 * Section 5's "clear failure message rather than a broken/partial PDF" -
 * callers must catch MetocNarrativeError and surface it, never fall back to
 * placeholder narrative text.
 */
export async function generateForecastDiscussion(days: NarrativeDayInput[], siteLabel: string): Promise<string> {
  if (!isAnthropicConfigured()) {
    throw new MetocNarrativeError(
      "AI narrative generation is not configured on this server (ANTHROPIC_API_KEY unset). The Unofficial MEF cannot be generated without it."
    );
  }
  if (days.length === 0) {
    throw new MetocNarrativeError("No forecast days supplied for narrative generation.");
  }

  const client = new Anthropic({ apiKey: env.anthropicApiKey, timeout: 45_000 });
  try {
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: buildPrompt(days, siteLabel) }],
    });
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock || !textBlock.text.trim()) {
      throw new MetocNarrativeError("AI narrative generation returned an empty response.");
    }
    return textBlock.text.trim();
  } catch (err) {
    if (err instanceof MetocNarrativeError) throw err;
    if (err instanceof Anthropic.APIError) {
      throw new MetocNarrativeError(`AI narrative generation failed (${err.status ?? "unknown"}): ${err.message}`);
    }
    throw new MetocNarrativeError(`AI narrative generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
