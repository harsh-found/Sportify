import { LiveEvent, StreamSource } from "../core/types";
import {
  detectSport,
  extractMatchNumberTag,
  parseCanonicalDate,
  parseEventEntities,
} from "../catalog/normalizer";
import { DrmHelper } from "../parsers/drm.helper";
import { parsePipeStreamUrl } from "../utils/stream-url";

/**
 * Generates an order-independent canonical key for a LiveEvent
 * incorporating sport, sorted team codes (or normalized title), match number tag, and calendar date.
 */
export function generateCanonicalMatchKey(
  title: string,
  category: string,
  startTime?: string,
  competition?: string
): string {
  const sport = detectSport(category, title);
  const parsed = parseEventEntities(title, competition);
  const datePart = startTime ? parseCanonicalDate(startTime) : "";
  const matchTag = parsed.matchNumberTag ? `::${parsed.matchNumberTag}` : "";

  if (parsed.kind === "match" && parsed.teams) {
    const codes = [
      parsed.teams.teamA.code.toLowerCase(),
      parsed.teams.teamB.code.toLowerCase(),
    ].sort();
    return `${sport}::${codes[0]}_vs_${codes[1]}${matchTag}${datePart ? `::${datePart}` : ""}`;
  }

  const slug = (parsed.tournament?.name || parsed.cleanTitle)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${sport}::${slug || "event"}${matchTag}${datePart ? `::${datePart}` : ""}`;
}

/**
 * Merges and deduplicates raw LiveEvent arrays across all 6 providers.
 * Preserves and merges DRM ClearKeys, HTTP headers, titles, and timestamps across identical stream URLs.
 */
export function mergeAndDeduplicateEvents(events: LiveEvent[]): LiveEvent[] {
  const eventMap = new Map<string, LiveEvent>();

  for (const event of events) {
    const key = generateCanonicalMatchKey(
      event.title,
      event.category,
      event.startTime,
      event.competition
    );

    // Normalize sources (extract inline pipe headers & DRM)
    const normalizedSources: StreamSource[] = event.sources.map((src) => {
      const parsed = parsePipeStreamUrl(src.streamUrl, src.headers, src.drm);
      return {
        ...src,
        streamUrl: parsed.cleanUrl || src.streamUrl,
        headers: Object.keys(parsed.headers).length > 0 ? parsed.headers : src.headers,
        drm: parsed.drm || src.drm,
      };
    });

    const existing = eventMap.get(key);
    if (!existing) {
      eventMap.set(key, {
        ...event,
        sources: [...normalizedSources],
      });
    } else {
      for (const src of normalizedSources) {
        const cleanIncomingUrl = src.streamUrl.split("|")[0].trim();
        const duplicateSource = existing.sources.find(
          (s) => s.streamUrl.split("|")[0].trim() === cleanIncomingUrl
        );

        if (!duplicateSource) {
          existing.sources.push(src);
        } else {
          if (src.drm) {
            duplicateSource.drm = DrmHelper.mergeDrm(duplicateSource.drm, src.drm);
          }
          if (src.headers) {
            duplicateSource.headers = {
              ...(src.headers || {}),
              ...(duplicateSource.headers || {}),
            };
          }
          if (!duplicateSource.title && src.title) {
            duplicateSource.title = src.title;
          }
        }
      }

      if (!existing.poster && event.poster) {
        existing.poster = event.poster;
      }
      if (!existing.startTime && event.startTime) {
        existing.startTime = event.startTime;
      }
      if (!existing.endTime && event.endTime) {
        existing.endTime = event.endTime;
      }
      if (!existing.competition && event.competition) {
        existing.competition = event.competition;
      }
      if (event.status === "LIVE") {
        existing.status = "LIVE";
      } else if (event.status === "UPCOMING" && existing.status === "ENDED") {
        existing.status = "UPCOMING";
      }
    }
  }

  return Array.from(eventMap.values());
}
