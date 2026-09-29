// v8.0 Section 8 - isolated test of the new AI-generation call, fed sample
// forecast data, run BEFORE wiring it into the full MEF PDF pipeline.
// Run with: npx tsx scripts/testMetocNarrative.ts
import { generateForecastDiscussion, type NarrativeDayInput } from "../src/services/metocNarrative";

const sampleDays: NarrativeDayInput[] = [
  {
    date: "2026-10-03",
    label: "Saturday",
    tempHighF: 58,
    tempLowF: 34,
    windSpeedText: "10 to 15 mph",
    windDirectionDeg: "NW",
    precipitationProbabilityPct: 10,
    shortForecast: "Mostly Sunny",
    detailedForecast: "Mostly sunny, with a high near 58. Northwest wind 10 to 15 mph.",
    povPercent: 8,
    primaryConcerns: [],
  },
  {
    date: "2026-10-04",
    label: "Sunday",
    tempHighF: 45,
    tempLowF: 18,
    windSpeedText: "20 to 28 mph",
    windDirectionDeg: "N",
    precipitationProbabilityPct: 70,
    shortForecast: "Snow Showers Likely",
    detailedForecast: "Snow showers likely, mainly after noon. Cloudy, with a high near 45. North wind 20 to 28 mph, with gusts as high as 38 mph. Chance of precipitation is 70%.",
    povPercent: 82,
    primaryConcerns: ["Low Surface Temperature Rule [LWCCR 15]", "Precipitation Flight Rule [LWCCR 13]", "Sustained Surface Wind Rule [LWCCR 8]"],
  },
  {
    date: "2026-10-05",
    label: "Monday",
    tempHighF: 52,
    tempLowF: 28,
    windSpeedText: "5 to 10 mph",
    windDirectionDeg: "SW",
    precipitationProbabilityPct: 15,
    shortForecast: "Partly Sunny",
    detailedForecast: "Partly sunny, with a high near 52. Southwest wind 5 to 10 mph.",
    povPercent: 12,
    primaryConcerns: [],
  },
];

(async () => {
  console.log("Generating sample Forecast Discussion for AAT-LC1 (test site)...\n");
  const text = await generateForecastDiscussion(sampleDays, "AAT-LC1 (Test Site)");
  console.log("--- Forecast Discussion ---\n");
  console.log(text);
  console.log("\n--- End ---");
})().catch((err) => {
  console.error("Test failed:", err.message);
  process.exit(1);
});
