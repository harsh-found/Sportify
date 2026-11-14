import { LiveEvent, StreamSource } from "../core/types";
import {
  NormalizedCatalogFixture,
  RichStreamFeed,
  SportCategory,
  TeamInfo,
  TournamentInfo,
  LanguageInfo,
  RenditionVariant,
} from "./types";
import { DrmHelper } from "../parsers/drm.helper";
import { buildProxyHeaderQuery, parsePipeStreamUrl } from "../utils/stream-url";
import { createHash } from "node:crypto";

export interface TeamAliasEntry {
  code: string;
  name: string;
  gender?: "men" | "women" | "mixed";
  ageGroup?: "senior" | "u19" | "u23" | "a-team" | "emerging";
  leagueId?: string;
}

/**
 * Known Team Alias Dictionary -> Canonical Code, Full Name, Gender, Age Group & Franchise League
 */
export const TEAM_ALIASES: Record<string, TeamAliasEntry> = {
  // International Cricket & Football Nations
  in: { code: "IND", name: "India", gender: "men", ageGroup: "senior" },
  ind: { code: "IND", name: "India", gender: "men", ageGroup: "senior" },
  india: { code: "IND", name: "India", gender: "men", ageGroup: "senior" },
  "india a": { code: "INDA", name: "India A", gender: "men", ageGroup: "a-team" },
  "ind a": { code: "INDA", name: "India A", gender: "men", ageGroup: "a-team" },
  "india u19": { code: "INDU19", name: "India U19", gender: "men", ageGroup: "u19" },
  "ind u19": { code: "INDU19", name: "India U19", gender: "men", ageGroup: "u19" },
  "india w": { code: "INDW", name: "India Women", gender: "women", ageGroup: "senior" },
  "ind w": { code: "INDW", name: "India Women", gender: "women", ageGroup: "senior" },
  "in w": { code: "INDW", name: "India Women", gender: "women", ageGroup: "senior" },
  "india women": { code: "INDW", name: "India Women", gender: "women", ageGroup: "senior" },

  nz: { code: "NZ", name: "New Zealand", gender: "men", ageGroup: "senior" },
  "new zealand": { code: "NZ", name: "New Zealand", gender: "men", ageGroup: "senior" },
  "nz a": { code: "NZA", name: "New Zealand A", gender: "men", ageGroup: "a-team" },
  "nz u19": { code: "NZU19", name: "New Zealand U19", gender: "men", ageGroup: "u19" },
  "nz w": { code: "NZW", name: "New Zealand Women", gender: "women", ageGroup: "senior" },
  "new zealand women": { code: "NZW", name: "New Zealand Women", gender: "women", ageGroup: "senior" },

  aus: { code: "AUS", name: "Australia", gender: "men", ageGroup: "senior" },
  australia: { code: "AUS", name: "Australia", gender: "men", ageGroup: "senior" },
  "aus a": { code: "AUSA", name: "Australia A", gender: "men", ageGroup: "a-team" },
  "australia a": { code: "AUSA", name: "Australia A", gender: "men", ageGroup: "a-team" },
  "aus u19": { code: "AUSU19", name: "Australia U19", gender: "men", ageGroup: "u19" },
  "australia u19": { code: "AUSU19", name: "Australia U19", gender: "men", ageGroup: "u19" },
  "aus w": { code: "AUSW", name: "Australia Women", gender: "women", ageGroup: "senior" },
  "australia women": { code: "AUSW", name: "Australia Women", gender: "women", ageGroup: "senior" },

  eng: { code: "ENG", name: "England", gender: "men", ageGroup: "senior" },
  england: { code: "ENG", name: "England", gender: "men", ageGroup: "senior" },
  "eng a": { code: "ENGA", name: "England Lions", gender: "men", ageGroup: "a-team" },
  "england lions": { code: "ENGA", name: "England Lions", gender: "men", ageGroup: "a-team" },
  "eng u19": { code: "ENGU19", name: "England U19", gender: "men", ageGroup: "u19" },
  "eng w": { code: "ENGW", name: "England Women", gender: "women", ageGroup: "senior" },
  "england women": { code: "ENGW", name: "England Women", gender: "women", ageGroup: "senior" },

  pak: { code: "PAK", name: "Pakistan", gender: "men", ageGroup: "senior" },
  pakistan: { code: "PAK", name: "Pakistan", gender: "men", ageGroup: "senior" },
  "pak a": { code: "PAKA", name: "Pakistan Shaheens", gender: "men", ageGroup: "a-team" },
  "pakistan shaheens": { code: "PAKA", name: "Pakistan Shaheens", gender: "men", ageGroup: "a-team" },
  "pak u19": { code: "PAKU19", name: "Pakistan U19", gender: "men", ageGroup: "u19" },
  "pak w": { code: "PAKW", name: "Pakistan Women", gender: "women", ageGroup: "senior" },
  "pakistan women": { code: "PAKW", name: "Pakistan Women", gender: "women", ageGroup: "senior" },

  sa: { code: "RSA", name: "South Africa", gender: "men", ageGroup: "senior" },
  rsa: { code: "RSA", name: "South Africa", gender: "men", ageGroup: "senior" },
  "south africa": { code: "RSA", name: "South Africa", gender: "men", ageGroup: "senior" },
  "sa a": { code: "RSAA", name: "South Africa A", gender: "men", ageGroup: "a-team" },
  "sa u19": { code: "RSAU19", name: "South Africa U19", gender: "men", ageGroup: "u19" },
  "sa w": { code: "RSAW", name: "South Africa Women", gender: "women", ageGroup: "senior" },
  "rsa w": { code: "RSAW", name: "South Africa Women", gender: "women", ageGroup: "senior" },
  "south africa women": { code: "RSAW", name: "South Africa Women", gender: "women", ageGroup: "senior" },

  sl: { code: "SL", name: "Sri Lanka", gender: "men", ageGroup: "senior" },
  "sri lanka": { code: "SL", name: "Sri Lanka", gender: "men", ageGroup: "senior" },
  "sl a": { code: "SLA", name: "Sri Lanka A", gender: "men", ageGroup: "a-team" },
  "sl u19": { code: "SLU19", name: "Sri Lanka U19", gender: "men", ageGroup: "u19" },
  "sl w": { code: "SLW", name: "Sri Lanka Women", gender: "women", ageGroup: "senior" },
  "sri lanka women": { code: "SLW", name: "Sri Lanka Women", gender: "women", ageGroup: "senior" },

  ban: { code: "BAN", name: "Bangladesh", gender: "men", ageGroup: "senior" },
  bangladesh: { code: "BAN", name: "Bangladesh", gender: "men", ageGroup: "senior" },
  "ban a": { code: "BANA", name: "Bangladesh A", gender: "men", ageGroup: "a-team" },
  "ban u19": { code: "BANU19", name: "Bangladesh U19", gender: "men", ageGroup: "u19" },
  "ban w": { code: "BANW", name: "Bangladesh Women", gender: "women", ageGroup: "senior" },
  "bangladesh women": { code: "BANW", name: "Bangladesh Women", gender: "women", ageGroup: "senior" },

  afg: { code: "AFG", name: "Afghanistan", gender: "men", ageGroup: "senior" },
  afghanistan: { code: "AFG", name: "Afghanistan", gender: "men", ageGroup: "senior" },
  "afg a": { code: "AFGA", name: "Afghanistan A", gender: "men", ageGroup: "a-team" },
  "afg u19": { code: "AFGU19", name: "Afghanistan U19", gender: "men", ageGroup: "u19" },

  wi: { code: "WI", name: "West Indies", gender: "men", ageGroup: "senior" },
  "west indies": { code: "WI", name: "West Indies", gender: "men", ageGroup: "senior" },
  "wi w": { code: "WIW", name: "West Indies Women", gender: "women", ageGroup: "senior" },
  "west indies women": { code: "WIW", name: "West Indies Women", gender: "women", ageGroup: "senior" },

  zim: { code: "ZIM", name: "Zimbabwe", gender: "men", ageGroup: "senior" },
  zimbabwe: { code: "ZIM", name: "Zimbabwe", gender: "men", ageGroup: "senior" },
  "zim w": { code: "ZIMW", name: "Zimbabwe Women", gender: "women", ageGroup: "senior" },

  ire: { code: "IRE", name: "Ireland", gender: "men", ageGroup: "senior" },
  ireland: { code: "IRE", name: "Ireland", gender: "men", ageGroup: "senior" },
  "ire w": { code: "IREW", name: "Ireland Women", gender: "women", ageGroup: "senior" },
  "ireland women": { code: "IREW", name: "Ireland Women", gender: "women", ageGroup: "senior" },

  ned: { code: "NED", name: "Netherlands", gender: "men", ageGroup: "senior" },
  netherlands: { code: "NED", name: "Netherlands", gender: "men", ageGroup: "senior" },
  sco: { code: "SCO", name: "Scotland", gender: "men", ageGroup: "senior" },
  scot: { code: "SCO", name: "Scotland", gender: "men", ageGroup: "senior" },
  scotland: { code: "SCO", name: "Scotland", gender: "men", ageGroup: "senior" },
  "sco w": { code: "SCOW", name: "Scotland Women", gender: "women", ageGroup: "senior" },
  nep: { code: "NEP", name: "Nepal", gender: "men", ageGroup: "senior" },
  nepal: { code: "NEP", name: "Nepal", gender: "men", ageGroup: "senior" },
  uae: { code: "UAE", name: "United Arab Emirates", gender: "men", ageGroup: "senior" },
  usa: { code: "USA", name: "United States", gender: "men", ageGroup: "senior" },
  nam: { code: "NAM", name: "Namibia", gender: "men", ageGroup: "senior" },
  namibia: { code: "NAM", name: "Namibia", gender: "men", ageGroup: "senior" },
  oma: { code: "OMA", name: "Oman", gender: "men", ageGroup: "senior" },
  oman: { code: "OMA", name: "Oman", gender: "men", ageGroup: "senior" },
  png: { code: "PNG", name: "Papua New Guinea", gender: "men", ageGroup: "senior" },
  can: { code: "CAN", name: "Canada", gender: "men", ageGroup: "senior" },
  canada: { code: "CAN", name: "Canada", gender: "men", ageGroup: "senior" },
  hk: { code: "HKG", name: "Hong Kong", gender: "men", ageGroup: "senior" },
  "hong kong": { code: "HKG", name: "Hong Kong", gender: "men", ageGroup: "senior" },
  kuw: { code: "KUW", name: "Kuwait", gender: "men", ageGroup: "senior" },
  kuwait: { code: "KUW", name: "Kuwait", gender: "men", ageGroup: "senior" },
  qat: { code: "QAT", name: "Qatar", gender: "men", ageGroup: "senior" },
  qatar: { code: "QAT", name: "Qatar", gender: "men", ageGroup: "senior" },
  uga: { code: "UGA", name: "Uganda", gender: "men", ageGroup: "senior" },
  uganda: { code: "UGA", name: "Uganda", gender: "men", ageGroup: "senior" },
  ken: { code: "KEN", name: "Kenya", gender: "men", ageGroup: "senior" },
  kenya: { code: "KEN", name: "Kenya", gender: "men", ageGroup: "senior" },
  ber: { code: "BER", name: "Bermuda", gender: "men", ageGroup: "senior" },
  bermuda: { code: "BER", name: "Bermuda", gender: "men", ageGroup: "senior" },
  ita: { code: "ITA", name: "Italy", gender: "men", ageGroup: "senior" },
  italy: { code: "ITA", name: "Italy", gender: "men", ageGroup: "senior" },
  jer: { code: "JER", name: "Jersey", gender: "men", ageGroup: "senior" },
  jersey: { code: "JER", name: "Jersey", gender: "men", ageGroup: "senior" },
  mal: { code: "MAS", name: "Malaysia", gender: "men", ageGroup: "senior" },
  malaysia: { code: "MAS", name: "Malaysia", gender: "men", ageGroup: "senior" },
  sin: { code: "SGP", name: "Singapore", gender: "men", ageGroup: "senior" },
  singapore: { code: "SGP", name: "Singapore", gender: "men", ageGroup: "senior" },

  // IPL Franchises (leagueId: tourn_ipl)
  csk: { code: "CSK", name: "Chennai Super Kings", gender: "men", leagueId: "tourn_ipl" },
  "chennai super kings": { code: "CSK", name: "Chennai Super Kings", gender: "men", leagueId: "tourn_ipl" },
  mi: { code: "MI", name: "Mumbai Indians", gender: "men", leagueId: "tourn_ipl" },
  "mumbai indians": { code: "MI", name: "Mumbai Indians", gender: "men", leagueId: "tourn_ipl" },
  rcb: { code: "RCB", name: "Royal Challengers Bengaluru", gender: "men", leagueId: "tourn_ipl" },
  "royal challengers bengaluru": { code: "RCB", name: "Royal Challengers Bengaluru", gender: "men", leagueId: "tourn_ipl" },
  "royal challengers bangalore": { code: "RCB", name: "Royal Challengers Bengaluru", gender: "men", leagueId: "tourn_ipl" },
  kkr: { code: "KKR", name: "Kolkata Knight Riders", gender: "men", leagueId: "tourn_ipl" },
  "kolkata knight riders": { code: "KKR", name: "Kolkata Knight Riders", gender: "men", leagueId: "tourn_ipl" },
  srh: { code: "SRH", name: "Sunrisers Hyderabad", gender: "men", leagueId: "tourn_ipl" },
  "sunrisers hyderabad": { code: "SRH", name: "Sunrisers Hyderabad", gender: "men", leagueId: "tourn_ipl" },
  dc: { code: "DC", name: "Delhi Capitals", gender: "men", leagueId: "tourn_ipl" },
  "delhi capitals": { code: "DC", name: "Delhi Capitals", gender: "men", leagueId: "tourn_ipl" },
  rr: { code: "RR", name: "Rajasthan Royals", gender: "men", leagueId: "tourn_ipl" },
  "rajasthan royals": { code: "RR", name: "Rajasthan Royals", gender: "men", leagueId: "tourn_ipl" },
  pbks: { code: "PBKS", name: "Punjab Kings", gender: "men", leagueId: "tourn_ipl" },
  "punjab kings": { code: "PBKS", name: "Punjab Kings", gender: "men", leagueId: "tourn_ipl" },
  gt: { code: "GT", name: "Gujarat Titans", gender: "men", leagueId: "tourn_ipl" },
  "gujarat titans": { code: "GT", name: "Gujarat Titans", gender: "men", leagueId: "tourn_ipl" },
  lsg: { code: "LSG", name: "Lucknow Super Giants", gender: "men", leagueId: "tourn_ipl" },
  "lucknow super giants": { code: "LSG", name: "Lucknow Super Giants", gender: "men", leagueId: "tourn_ipl" },

  // WPL Franchises (leagueId: tourn_wpl)
  "mi w": { code: "MIW", name: "Mumbai Indians Women", gender: "women", leagueId: "tourn_wpl" },
  miw: { code: "MIW", name: "Mumbai Indians Women", gender: "women", leagueId: "tourn_wpl" },
  "mumbai indians women": { code: "MIW", name: "Mumbai Indians Women", gender: "women", leagueId: "tourn_wpl" },
  "rcb w": { code: "RCBW", name: "Royal Challengers Bengaluru Women", gender: "women", leagueId: "tourn_wpl" },
  rcbw: { code: "RCBW", name: "Royal Challengers Bengaluru Women", gender: "women", leagueId: "tourn_wpl" },
  "royal challengers bengaluru women": { code: "RCBW", name: "Royal Challengers Bengaluru Women", gender: "women", leagueId: "tourn_wpl" },
  "royal challengers bangalore women": { code: "RCBW", name: "Royal Challengers Bengaluru Women", gender: "women", leagueId: "tourn_wpl" },
  "dc w": { code: "DCW", name: "Delhi Capitals Women", gender: "women", leagueId: "tourn_wpl" },
  dcw: { code: "DCW", name: "Delhi Capitals Women", gender: "women", leagueId: "tourn_wpl" },
  "delhi capitals women": { code: "DCW", name: "Delhi Capitals Women", gender: "women", leagueId: "tourn_wpl" },
  "gg w": { code: "GGW", name: "Gujarat Giants Women", gender: "women", leagueId: "tourn_wpl" },
  ggw: { code: "GGW", name: "Gujarat Giants Women", gender: "women", leagueId: "tourn_wpl" },
  "gujarat giants": { code: "GGW", name: "Gujarat Giants Women", gender: "women", leagueId: "tourn_wpl" },
  "gujarat giants women": { code: "GGW", name: "Gujarat Giants Women", gender: "women", leagueId: "tourn_wpl" },
  upw: { code: "UPW", name: "UP Warriorz Women", gender: "women", leagueId: "tourn_wpl" },
  "up warriorz": { code: "UPW", name: "UP Warriorz Women", gender: "women", leagueId: "tourn_wpl" },
  "up warriorz women": { code: "UPW", name: "UP Warriorz Women", gender: "women", leagueId: "tourn_wpl" },

  // PSL Franchises (leagueId: tourn_psl)
  iu: { code: "IU", name: "Islamabad United", gender: "men", leagueId: "tourn_psl" },
  "islamabad united": { code: "IU", name: "Islamabad United", gender: "men", leagueId: "tourn_psl" },
  kk: { code: "KK", name: "Karachi Kings", gender: "men", leagueId: "tourn_psl" },
  "karachi kings": { code: "KK", name: "Karachi Kings", gender: "men", leagueId: "tourn_psl" },
  lq: { code: "LQ", name: "Lahore Qalandars", gender: "men", leagueId: "tourn_psl" },
  "lahore qalandars": { code: "LQ", name: "Lahore Qalandars", gender: "men", leagueId: "tourn_psl" },
  ms: { code: "MS", name: "Multan Sultans", gender: "men", leagueId: "tourn_psl" },
  "multan sultans": { code: "MS", name: "Multan Sultans", gender: "men", leagueId: "tourn_psl" },
  pz: { code: "PZ", name: "Peshawar Zalmi", gender: "men", leagueId: "tourn_psl" },
  "peshawar zalmi": { code: "PZ", name: "Peshawar Zalmi", gender: "men", leagueId: "tourn_psl" },
  qg: { code: "QG", name: "Quetta Gladiators", gender: "men", leagueId: "tourn_psl" },
  "quetta gladiators": { code: "QG", name: "Quetta Gladiators", gender: "men", leagueId: "tourn_psl" },

  // BBL Franchises (leagueId: tourn_bbl)
  str: { code: "STR", name: "Adelaide Strikers", gender: "men", leagueId: "tourn_bbl" },
  "adelaide strikers": { code: "STR", name: "Adelaide Strikers", gender: "men", leagueId: "tourn_bbl" },
  hea: { code: "HEA", name: "Brisbane Heat", gender: "men", leagueId: "tourn_bbl" },
  "brisbane heat": { code: "HEA", name: "Brisbane Heat", gender: "men", leagueId: "tourn_bbl" },
  hur: { code: "HUR", name: "Hobart Hurricanes", gender: "men", leagueId: "tourn_bbl" },
  "hobart hurricanes": { code: "HUR", name: "Hobart Hurricanes", gender: "men", leagueId: "tourn_bbl" },
  ren: { code: "REN", name: "Melbourne Renegades", gender: "men", leagueId: "tourn_bbl" },
  "melbourne renegades": { code: "REN", name: "Melbourne Renegades", gender: "men", leagueId: "tourn_bbl" },
  sta: { code: "STA", name: "Melbourne Stars", gender: "men", leagueId: "tourn_bbl" },
  "melbourne stars": { code: "STA", name: "Melbourne Stars", gender: "men", leagueId: "tourn_bbl" },
  sco_bbl: { code: "PER", name: "Perth Scorchers", gender: "men", leagueId: "tourn_bbl" },
  per: { code: "PER", name: "Perth Scorchers", gender: "men", leagueId: "tourn_bbl" },
  "perth scorchers": { code: "PER", name: "Perth Scorchers", gender: "men", leagueId: "tourn_bbl" },
  six: { code: "SIX", name: "Sydney Sixers", gender: "men", leagueId: "tourn_bbl" },
  "sydney sixers": { code: "SIX", name: "Sydney Sixers", gender: "men", leagueId: "tourn_bbl" },
  thu: { code: "THU", name: "Sydney Thunder", gender: "men", leagueId: "tourn_bbl" },
  "sydney thunder": { code: "THU", name: "Sydney Thunder", gender: "men", leagueId: "tourn_bbl" },

  // WBBL Franchises (leagueId: tourn_wbbl)
  strw: { code: "STRW", name: "Adelaide Strikers Women", gender: "women", leagueId: "tourn_wbbl" },
  "str w": { code: "STRW", name: "Adelaide Strikers Women", gender: "women", leagueId: "tourn_wbbl" },
  "adelaide strikers women": { code: "STRW", name: "Adelaide Strikers Women", gender: "women", leagueId: "tourn_wbbl" },
  "adelaide strikers w": { code: "STRW", name: "Adelaide Strikers Women", gender: "women", leagueId: "tourn_wbbl" },
  heaw: { code: "HEAW", name: "Brisbane Heat Women", gender: "women", leagueId: "tourn_wbbl" },
  "hea w": { code: "HEAW", name: "Brisbane Heat Women", gender: "women", leagueId: "tourn_wbbl" },
  "brisbane heat women": { code: "HEAW", name: "Brisbane Heat Women", gender: "women", leagueId: "tourn_wbbl" },
  "brisbane heat w": { code: "HEAW", name: "Brisbane Heat Women", gender: "women", leagueId: "tourn_wbbl" },
  hurw: { code: "HURW", name: "Hobart Hurricanes Women", gender: "women", leagueId: "tourn_wbbl" },
  "hur w": { code: "HURW", name: "Hobart Hurricanes Women", gender: "women", leagueId: "tourn_wbbl" },
  "hobart hurricanes women": { code: "HURW", name: "Hobart Hurricanes Women", gender: "women", leagueId: "tourn_wbbl" },
  "hobart hurricanes w": { code: "HURW", name: "Hobart Hurricanes Women", gender: "women", leagueId: "tourn_wbbl" },
  renw: { code: "RENW", name: "Melbourne Renegades Women", gender: "women", leagueId: "tourn_wbbl" },
  "ren w": { code: "RENW", name: "Melbourne Renegades Women", gender: "women", leagueId: "tourn_wbbl" },
  "melbourne renegades women": { code: "RENW", name: "Melbourne Renegades Women", gender: "women", leagueId: "tourn_wbbl" },
  "melbourne renegades w": { code: "RENW", name: "Melbourne Renegades Women", gender: "women", leagueId: "tourn_wbbl" },
  staw: { code: "STAW", name: "Melbourne Stars Women", gender: "women", leagueId: "tourn_wbbl" },
  "sta w": { code: "STAW", name: "Melbourne Stars Women", gender: "women", leagueId: "tourn_wbbl" },
  "melbourne stars women": { code: "STAW", name: "Melbourne Stars Women", gender: "women", leagueId: "tourn_wbbl" },
  "melbourne stars w": { code: "STAW", name: "Melbourne Stars Women", gender: "women", leagueId: "tourn_wbbl" },
  perw: { code: "PERW", name: "Perth Scorchers Women", gender: "women", leagueId: "tourn_wbbl" },
  "per w": { code: "PERW", name: "Perth Scorchers Women", gender: "women", leagueId: "tourn_wbbl" },
  "perth scorchers women": { code: "PERW", name: "Perth Scorchers Women", gender: "women", leagueId: "tourn_wbbl" },
  "perth scorchers w": { code: "PERW", name: "Perth Scorchers Women", gender: "women", leagueId: "tourn_wbbl" },
  sixw: { code: "SIXW", name: "Sydney Sixers Women", gender: "women", leagueId: "tourn_wbbl" },
  "six w": { code: "SIXW", name: "Sydney Sixers Women", gender: "women", leagueId: "tourn_wbbl" },
  "sydney sixers women": { code: "SIXW", name: "Sydney Sixers Women", gender: "women", leagueId: "tourn_wbbl" },
  "sydney sixers w": { code: "SIXW", name: "Sydney Sixers Women", gender: "women", leagueId: "tourn_wbbl" },
  thuw: { code: "THUW", name: "Sydney Thunder Women", gender: "women", leagueId: "tourn_wbbl" },
  "thu w": { code: "THUW", name: "Sydney Thunder Women", gender: "women", leagueId: "tourn_wbbl" },
  "sydney thunder women": { code: "THUW", name: "Sydney Thunder Women", gender: "women", leagueId: "tourn_wbbl" },
  "sydney thunder w": { code: "THUW", name: "Sydney Thunder Women", gender: "women", leagueId: "tourn_wbbl" },

  // SA20 Franchises (leagueId: tourn_sa20)
  mict: { code: "MICT", name: "MI Cape Town", gender: "men", leagueId: "tourn_sa20" },
  "mi cape town": { code: "MICT", name: "MI Cape Town", gender: "men", leagueId: "tourn_sa20" },
  jsk: { code: "JSK", name: "Joburg Super Kings", gender: "men", leagueId: "tourn_sa20" },
  "joburg super kings": { code: "JSK", name: "Joburg Super Kings", gender: "men", leagueId: "tourn_sa20" },
  pc: { code: "PC", name: "Pretoria Capitals", gender: "men", leagueId: "tourn_sa20" },
  "pretoria capitals": { code: "PC", name: "Pretoria Capitals", gender: "men", leagueId: "tourn_sa20" },
  pr: { code: "PR", name: "Paarl Royals", gender: "men", leagueId: "tourn_sa20" },
  "paarl royals": { code: "PR", name: "Paarl Royals", gender: "men", leagueId: "tourn_sa20" },
  dsg: { code: "DSG", name: "Durban's Super Giants", gender: "men", leagueId: "tourn_sa20" },
  "durban super giants": { code: "DSG", name: "Durban's Super Giants", gender: "men", leagueId: "tourn_sa20" },
  sec: { code: "SEC", name: "Sunrisers Eastern Cape", gender: "men", leagueId: "tourn_sa20" },
  "sunrisers eastern cape": { code: "SEC", name: "Sunrisers Eastern Cape", gender: "men", leagueId: "tourn_sa20" },

  // European & Global Football Clubs
  rma: { code: "RMA", name: "Real Madrid", gender: "men" },
  "real madrid": { code: "RMA", name: "Real Madrid", gender: "men" },
  bar: { code: "BAR", name: "Barcelona", gender: "men" },
  barcelona: { code: "BAR", name: "Barcelona", gender: "men" },
  "fc barcelona": { code: "BAR", name: "Barcelona", gender: "men" },
  atm: { code: "ATM", name: "Atletico Madrid", gender: "men" },
  "atletico madrid": { code: "ATM", name: "Atletico Madrid", gender: "men" },
  mci: { code: "MCI", name: "Manchester City", gender: "men" },
  "man city": { code: "MCI", name: "Manchester City", gender: "men" },
  "manchester city": { code: "MCI", name: "Manchester City", gender: "men" },
  mun: { code: "MUN", name: "Manchester United", gender: "men" },
  "man utd": { code: "MUN", name: "Manchester United", gender: "men" },
  "man united": { code: "MUN", name: "Manchester United", gender: "men" },
  "manchester united": { code: "MUN", name: "Manchester United", gender: "men" },
  liv: { code: "LIV", name: "Liverpool", gender: "men" },
  liverpool: { code: "LIV", name: "Liverpool", gender: "men" },
  ars: { code: "ARS", name: "Arsenal", gender: "men" },
  arsenal: { code: "ARS", name: "Arsenal", gender: "men" },
  che: { code: "CHE", name: "Chelsea", gender: "men" },
  chelsea: { code: "CHE", name: "Chelsea", gender: "men" },
  tot: { code: "TOT", name: "Tottenham Hotspur", gender: "men" },
  tottenham: { code: "TOT", name: "Tottenham Hotspur", gender: "men" },
  spurs: { code: "TOT", name: "Tottenham Hotspur", gender: "men" },
  new: { code: "NEW", name: "Newcastle United", gender: "men" },
  "newcastle united": { code: "NEW", name: "Newcastle United", gender: "men" },
  avl: { code: "AVL", name: "Aston Villa", gender: "men" },
  "aston villa": { code: "AVL", name: "Aston Villa", gender: "men" },
  bay: { code: "BAY", name: "Bayern Munich", gender: "men" },
  "bayern munich": { code: "BAY", name: "Bayern Munich", gender: "men" },
  bvb: { code: "BVB", name: "Borussia Dortmund", gender: "men" },
  dortmund: { code: "BVB", name: "Borussia Dortmund", gender: "men" },
  "borussia dortmund": { code: "BVB", name: "Borussia Dortmund", gender: "men" },
  psg: { code: "PSG", name: "Paris Saint-Germain", gender: "men" },
  "paris saint-germain": { code: "PSG", name: "Paris Saint-Germain", gender: "men" },
  juv: { code: "JUV", name: "Juventus", gender: "men" },
  juventus: { code: "JUV", name: "Juventus", gender: "men" },
  int: { code: "INT", name: "Inter Milan", gender: "men" },
  "inter milan": { code: "INT", name: "Inter Milan", gender: "men" },
  acm: { code: "ACM", name: "AC Milan", gender: "men" },
  "ac milan": { code: "ACM", name: "AC Milan", gender: "men" },
};

/**
 * Known League / Tournament Signatures
 */
export const TOURNAMENT_SIGNATURES: {
  pattern: RegExp;
  info: TournamentInfo;
  sport: SportCategory;
}[] = [
  {
    pattern: /\b(nepal premier league|npl)\b/i,
    info: { id: "tourn_npl", name: "Nepal Premier League", shortName: "NPL T20", category: "T20 Franchise League" },
    sport: "cricket",
  },
  {
    pattern: /\b(indian premier league|tata ipl|\bipl\b)\b/i,
    info: { id: "tourn_ipl", name: "Indian Premier League", shortName: "IPL", category: "T20 Franchise League" },
    sport: "cricket",
  },
  {
    pattern: /\b(women'?s big bash|wbbl)\b/i,
    info: { id: "tourn_wbbl", name: "Women's Big Bash League", shortName: "WBBL", category: "Women's T20 League" },
    sport: "cricket",
  },
  {
    pattern: /\b(big bash league|\bbbl\b)\b/i,
    info: { id: "tourn_bbl", name: "Big Bash League", shortName: "BBL", category: "T20 Franchise League" },
    sport: "cricket",
  },
  {
    pattern: /\b(pakistan super league|\bpsl\b)\b/i,
    info: { id: "tourn_psl", name: "Pakistan Super League", shortName: "PSL", category: "T20 Franchise League" },
    sport: "cricket",
  },
  {
    pattern: /\b(women'?s premier league|\bwpl\b)\b/i,
    info: { id: "tourn_wpl", name: "Women's Premier League", shortName: "WPL", category: "Women's T20 League" },
    sport: "cricket",
  },
  {
    pattern: /\b(sa20|betway sa20)\b/i,
    info: { id: "tourn_sa20", name: "SA20 League", shortName: "SA20", category: "T20 Franchise League" },
    sport: "cricket",
  },
  {
    pattern: /\b(caribbean premier league|\bcpl\b)\b/i,
    info: { id: "tourn_cpl", name: "Caribbean Premier League", shortName: "CPL", category: "T20 Franchise League" },
    sport: "cricket",
  },
  {
    pattern: /\b(ilt20|international league t20)\b/i,
    info: { id: "tourn_ilt20", name: "International League T20", shortName: "ILT20", category: "T20 Franchise League" },
    sport: "cricket",
  },
  {
    pattern: /\b(lanka premier league|\blpl\b)\b/i,
    info: { id: "tourn_lpl", name: "Lanka Premier League", shortName: "LPL", category: "T20 Franchise League" },
    sport: "cricket",
  },
  {
    pattern: /\b(bangladesh premier league|\bbpl\b)\b/i,
    info: { id: "tourn_bpl", name: "Bangladesh Premier League", shortName: "BPL", category: "T20 Franchise League" },
    sport: "cricket",
  },
  {
    pattern: /\b(champions trophy)\b/i,
    info: { id: "tourn_ct", name: "ICC Champions Trophy", shortName: "Champions Trophy", category: "ICC International" },
    sport: "cricket",
  },
  {
    pattern: /\b(world test championship|\bwtc\b)\b/i,
    info: { id: "tourn_wtc", name: "ICC World Test Championship", shortName: "WTC", category: "ICC Test Cricket" },
    sport: "cricket",
  },
  {
    pattern: /\b(asia cup)\b/i,
    info: { id: "tourn_asiacup", name: "ACC Asia Cup", shortName: "Asia Cup", category: "International Cricket" },
    sport: "cricket",
  },
  {
    pattern: /\b(t20 world cup)\b/i,
    info: { id: "tourn_t20wc", name: "ICC T20 World Cup", shortName: "T20 WC", category: "ICC International" },
    sport: "cricket",
  },
  {
    pattern: /\b(champions league|\bucl\b)\b/i,
    info: { id: "tourn_ucl", name: "UEFA Champions League", shortName: "UCL", category: "European Club Football" },
    sport: "football",
  },
  {
    pattern: /\b(europa league|\buel\b)\b/i,
    info: { id: "tourn_uel", name: "UEFA Europa League", shortName: "UEL", category: "European Club Football" },
    sport: "football",
  },
  {
    pattern: /\b(english premier league|\bepl\b|premier league)\b/i,
    info: { id: "tourn_epl", name: "English Premier League", shortName: "EPL", category: "Club Football" },
    sport: "football",
  },
  {
    pattern: /\b(la liga|laliga)\b/i,
    info: { id: "tourn_laliga", name: "LaLiga", shortName: "LaLiga", category: "Spanish Football" },
    sport: "football",
  },
  {
    pattern: /\b(serie a)\b/i,
    info: { id: "tourn_seriea", name: "Serie A", shortName: "Serie A", category: "Italian Football" },
    sport: "football",
  },
  {
    pattern: /\b(bundesliga)\b/i,
    info: { id: "tourn_bundesliga", name: "Bundesliga", shortName: "Bundesliga", category: "German Football" },
    sport: "football",
  },
  {
    pattern: /\b(indian super league|\bisl\b)\b/i,
    info: { id: "tourn_isl", name: "Indian Super League", shortName: "ISL", category: "Indian Football" },
    sport: "football",
  },
  {
    pattern: /\b(formula 1|\bf1\b|grand prix)\b/i,
    info: { id: "tourn_f1", name: "Formula 1 World Championship", shortName: "Formula 1", category: "Motorsport" },
    sport: "motorsport",
  },
  {
    pattern: /\b(motogp|moto gp)\b/i,
    info: { id: "tourn_motogp", name: "MotoGP World Championship", shortName: "MotoGP", category: "Motorsport" },
    sport: "motorsport",
  },
  {
    pattern: /\b(ufc|ultimate fighting)\b/i,
    info: { id: "tourn_ufc", name: "Ultimate Fighting Championship", shortName: "UFC", category: "MMA" },
    sport: "mma",
  },
  {
    pattern: /\b(wwe|smackdown|wrestlemania|monday night raw|\bnxt\b)\b/i,
    info: { id: "tourn_wwe", name: "World Wrestling Entertainment", shortName: "WWE", category: "Pro Wrestling" },
    sport: "wwe",
  },
  {
    pattern: /\b(pro kabaddi|\bpkl\b)\b/i,
    info: { id: "tourn_pkl", name: "Pro Kabaddi League", shortName: "PKL", category: "Kabaddi" },
    sport: "kabaddi",
  },
];

const TOURNAMENT_BY_ID: Record<string, TournamentInfo> = Object.fromEntries(
  TOURNAMENT_SIGNATURES.map((s) => [s.info.id, s.info])
);

/**
 * Provider Reliability Ranking & Display Names
 */
export const PROVIDER_TRUST_RANK: Record<string, { score: number; displayName: string }> = {
  cricify: { score: 96, displayName: "Cricify Live" },
  sportzx: { score: 94, displayName: "Sportzx" },
  sktech: { score: 92, displayName: "SKTech Sports" },
  playztv: { score: 91, displayName: "PlayZ TV" },
  livxow: { score: 89, displayName: "LivXow Live" },
  playfy: { score: 87, displayName: "PlayFy TV" },
};

/**
 * Extracts explicit match number / stage identifier (e.g., "1st odi", "2nd test", "match 14", "semi final", "final")
 * so distinct matches between the same two teams never falsely coalesce.
 */
export function extractMatchNumberTag(title: string): string | null {
  const lower = title.toLowerCase();
  const ordinalMatch = lower.match(/\b(\d+(?:st|nd|rd|th)\s*(?:t20i?|odi|test|match|game|leg))\b/i);
  if (ordinalMatch) {
    return ordinalMatch[1].replace(/\s+/g, "-");
  }
  const matchNum = lower.match(/\b(?:match|game|day)\s*#?\s*(\d+)\b/i);
  if (matchNum) {
    return `match-${matchNum[1]}`;
  }
  if (/\b(semi[-\s]?final)\b/i.test(lower)) return "semi-final";
  if (/\b(quarter[-\s]?final)\b/i.test(lower)) return "quarter-final";
  if (/\b(eliminator)\b/i.test(lower)) return "eliminator";
  if (/\b(qualifier\s*\d*)\b/i.test(lower)) {
    const qm = lower.match(/\b(qualifier\s*\d*)\b/i);
    return qm ? qm[1].replace(/\s+/g, "-") : "qualifier";
  }
  if (/\b(grand\s+final|\bfinal\b)\b/i.test(lower) && !/\b(semi|quarter)\b/i.test(lower)) {
    return "final";
  }
  return null;
}

/**
 * Extracts explicit match format (e.g. T20I, ODI, TEST, T20, T10) from title or tournament context.
 */
export function extractMatchFormat(title: string, tournament?: TournamentInfo | null): string | null {
  const combined = `${title} ${tournament?.name || ""} ${tournament?.category || ""}`.toLowerCase();
  if (/\b(t20i)\b/i.test(combined)) return "T20I";
  if (/\b(odi|one day international|champions trophy)\b/i.test(combined)) return "ODI";
  if (/\b(test match|\d+(?:st|nd|rd|th)\s*test|world test championship|\bwtc\b|ashes)\b/i.test(combined)) return "TEST";
  if (/\b(t10)\b/i.test(combined)) return "T10";
  if (/\b(t20|ipl|wpl|bbl|wbbl|psl|sa20|cpl|ilt20|lpl|bpl|npl)\b/i.test(combined)) return "T20";
  return null;
}

/**
 * Extracts tournament stage (e.g. final, semi-final, quarter-final, qualifier, eliminator, group, league).
 */
export function extractMatchStage(title: string): string | null {
  const lower = title.toLowerCase();
  if (/\b(semi[-\s]?final)\b/i.test(lower)) return "semi-final";
  if (/\b(quarter[-\s]?final)\b/i.test(lower)) return "quarter-final";
  if (/\b(eliminator)\b/i.test(lower)) return "eliminator";
  if (/\b(qualifier)\b/i.test(lower)) return "qualifier";
  if (/\b(grand\s+final|\bfinal\b)\b/i.test(lower) && !/\b(semi|quarter)\b/i.test(lower)) return "final";
  if (/\b(super\s*8|super\s*eight|super\s*4|super\s*four)\b/i.test(lower)) return "super-stage";
  if (/\b(group\s+[a-z0-9])\b/i.test(lower)) return "group";
  return null;
}

/**
 * Detects sport category from raw category and title strings
 */
export function detectSport(rawCategory: string, rawTitle: string): SportCategory {
  const catLower = (rawCategory || "").toLowerCase().trim();
  const combined = `${rawCategory} ${rawTitle}`.toLowerCase();

  for (const sig of TOURNAMENT_SIGNATURES) {
    if (sig.pattern.test(combined)) {
      return sig.sport;
    }
  }

  // Respect explicit upstream sport category when unambiguous
  if (/\b(hockey|nhl|ice hockey|fih)\b/i.test(catLower)) return "hockey";
  if (/\b(basketball|nba|wnba|euroleague|fiba)\b/i.test(catLower)) return "basketball";
  if (/\b(table tennis|ping pong|wtt)\b/i.test(catLower)) return "table-tennis";
  if (/\b(tennis|atp|wta)\b/i.test(catLower)) return "tennis";
  if (/\b(motorsport|racing|formula|f1|motogp)\b/i.test(catLower)) return "motorsport";
  if (/\b(mma|ufc|boxing|combat|fight)\b/i.test(catLower)) return "mma";
  if (/\b(wwe|wrestling)\b/i.test(catLower)) return "wwe";
  if (/\b(kabaddi|pkl)\b/i.test(catLower)) return "kabaddi";
  if (/\b(badminton|bwf)\b/i.test(catLower)) return "badminton";
  if (/\b(volleyball|fivb)\b/i.test(catLower)) return "volleyball";
  if (/\b(rugby)\b/i.test(catLower)) return "rugby";
  if (/\b(golf|pga|liv golf)\b/i.test(catLower)) return "golf";
  if (/\b(football|soccer)\b/i.test(catLower)) return "football";
  if (/\b(cricket)\b/i.test(catLower)) return "cricket";

  if (
    /\b(cricket|t20|t20i|odi|test match|ipl|psl|bbl|wbbl|npl|wpl|sa20|cpl|ranji|ashes|willow|cric|ind vs|pak vs|aus vs|eng vs|nz vs|sa vs|sl vs|ban vs|wi vs|afg vs|adelaide strikers|perth scorchers|sydney sixers|sydney thunder|melbourne renegades|hobart hurricanes|brisbane heat|knight riders|super kings)\b/i.test(
      combined
    )
  ) {
    return "cricket";
  }
  if (
    /\b(football|soccer|premier league|laliga|la liga|serie a|bundesliga|ligue 1|ucl|champions league|europa|fa cup|isl|fifa|euro|copa|madrid|barcelona|arsenal|chelsea|liverpool|man city|man utd)\b/i.test(
      combined
    )
  ) {
    return "football";
  }
  if (/\b(f1|formula 1|formula one|motogp|nascar|indycar|rally|grand prix|racing|motorsport)\b/i.test(combined)) {
    return "motorsport";
  }
  if (/\b(table tennis|wtt|ittf|ping pong)\b/i.test(combined)) {
    return "table-tennis";
  }
  if (/\b(tennis|atp|wta|wimbledon|roland garros|us open|australian open|davis cup)\b/i.test(combined)) {
    return "tennis";
  }
  if (/\b(basketball|nba|euroleague|wnba|fiba|lakers|celtics|warriors|knicks|bulls|timberwolves|cavaliers|mavericks)\b/i.test(combined)) {
    return "basketball";
  }
  if (/\b(ufc|mma|bellator|pfl|one championship|cage|boxing|fight night)\b/i.test(combined)) {
    return "mma";
  }
  if (/\b(wwe|wrestling|aew|smackdown|raw|wrestlemania|royal rumble)\b/i.test(combined)) {
    return "wwe";
  }
  if (/\b(kabaddi|pkl|pro kabaddi)\b/i.test(combined)) {
    return "kabaddi";
  }
  if (/\b(hockey|nhl|fih|kraken|bruins|maple leafs|oilers|canadiens|avalanche|blackhawks|flyers|penguins|senators|islanders|devils|flames|red wings|sharks)\b/i.test(combined)) {
    return "hockey";
  }
  if (/\b(golf|pga|lpga|masters|ryder cup|liv golf)\b/i.test(combined)) {
    return "golf";
  }
  if (/\b(badminton|bwf|thomas cup|uber cup)\b/i.test(combined)) {
    return "badminton";
  }
  if (/\b(volleyball|fivb|vnl)\b/i.test(combined)) {
    return "volleyball";
  }
  if (/\b(rugby|six nations|super rugby)\b/i.test(combined)) {
    return "rugby";
  }

  return "other";
}

/**
 * Resolves a raw team name into a canonical TeamInfo structure with gender, ageGroup, and leagueId metadata.
 */
export function normalizeTeam(rawName: string): TeamInfo {
  const cleaned = rawName
    .replace(/\[.*?\]|\(.*?\)/g, "")
    .replace(/\b(live|stream|hd|fhd|uhd|4k|1080p|720p|1st|2nd|3rd|4th|5th|odi|t20|t20i|test|match)\b/gi, "")
    .replace(/[^a-zA-Z0-9\s&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const lower = cleaned.toLowerCase();
  if (TEAM_ALIASES[lower]) {
    const entry = TEAM_ALIASES[lower];
    return {
      id: `team_${entry.code.toLowerCase()}`,
      name: entry.name,
      shortName: entry.code,
      code: entry.code,
      gender: entry.gender || "men",
      ageGroup: entry.ageGroup || "senior",
      leagueId: entry.leagueId || null,
    };
  }

  // Check for age-group or women's modifiers on a known base team (e.g., "India Under-19", "Australia Women", "Adelaide Strikers W")
  const isU19 = /\b(u-?19|under[-\s]?19)\b/i.test(cleaned);
  const isWomen = /\b(women'?s?|wmn|\bw\b)\b/i.test(cleaned);
  if (isU19 || isWomen) {
    const baseName = cleaned
      .replace(/\b(u-?19|under[-\s]?19|women'?s?|wmn|\bw\b)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    const baseEntry = TEAM_ALIASES[baseName];
    if (baseEntry) {
      if (isU19) {
        const u19Code = `${baseEntry.code}U19`;
        return {
          id: `team_${u19Code.toLowerCase()}`,
          name: `${baseEntry.name} U19`,
          shortName: u19Code,
          code: u19Code,
          gender: isWomen ? "women" : "men",
          ageGroup: "u19",
          leagueId: baseEntry.leagueId || null,
        };
      }
      if (isWomen) {
        const wKey = `${baseName} w`;
        if (TEAM_ALIASES[wKey]) {
          const wEntry = TEAM_ALIASES[wKey];
          return {
            id: `team_${wEntry.code.toLowerCase()}`,
            name: wEntry.name,
            shortName: wEntry.code,
            code: wEntry.code,
            gender: "women",
            ageGroup: wEntry.ageGroup || "senior",
            leagueId: wEntry.leagueId || null,
          };
        }
        const wCode = baseEntry.code.endsWith("W") ? baseEntry.code : `${baseEntry.code}W`;
        const wLeague =
          baseEntry.leagueId === "tourn_bbl"
            ? "tourn_wbbl"
            : baseEntry.leagueId === "tourn_ipl"
            ? "tourn_wpl"
            : baseEntry.leagueId || null;
        return {
          id: `team_${wCode.toLowerCase()}`,
          name: baseEntry.name.endsWith("Women") ? baseEntry.name : `${baseEntry.name} Women`,
          shortName: wCode,
          code: wCode,
          gender: "women",
          ageGroup: "senior",
          leagueId: wLeague,
        };
      }
    }
  }

  const words = cleaned.split(" ").filter(Boolean);
  let code = "";
  if (words.length === 1) {
    code = words[0].slice(0, 3).toUpperCase();
  } else {
    code = words
      .map((w) => w[0])
      .join("")
      .slice(0, 4)
      .toUpperCase();
  }

  if (!code) code = "TBD";

  return {
    id: `team_${cleaned.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "tbd"}`,
    name: cleaned || rawName.trim(),
    shortName: code,
    code,
    gender: isWomen ? "women" : "men",
    ageGroup: isU19 ? "u19" : "senior",
    leagueId: null,
  };
}

export interface ParsedEventEntities {
  kind: "match" | "tournament_channel";
  cleanTitle: string;
  teams: { teamA: TeamInfo; teamB: TeamInfo } | null;
  tournament: TournamentInfo | null;
  matchNumberTag?: string | null;
  matchFormat?: string | null;
  matchStage?: string | null;
  eventConfidence?: number;
}

/**
 * Promotes a men's/base franchise team to its Women's counterpart when the match context is explicitly WBBL or WPL.
 */
function promoteTeamToWomenIfContextMatches(team: TeamInfo, tournamentId?: string | null): TeamInfo {
  if (team.gender === "women" || team.code.endsWith("W")) return team;
  const wLookup = TEAM_ALIASES[`${team.code.toLowerCase()} w`];
  if (wLookup) {
    return {
      id: `team_${wLookup.code.toLowerCase()}`,
      name: wLookup.name,
      shortName: wLookup.code,
      code: wLookup.code,
      gender: "women",
      ageGroup: wLookup.ageGroup || "senior",
      leagueId: wLookup.leagueId || tournamentId || null,
    };
  }
  const wCode = `${team.code}W`;
  return {
    ...team,
    id: `team_${wCode.toLowerCase()}`,
    name: team.name.endsWith("Women") ? team.name : `${team.name} Women`,
    shortName: wCode,
    code: wCode,
    gender: "women",
    leagueId: tournamentId || team.leagueId || null,
  };
}

/**
 * Intelligent Entity Parser:
 * Distinguishes real head-to-head matches from league/tournament channels (e.g. "NPL vs NPL" or "Nepal Premier League").
 * Handles:
 *  - "Team A vs Team B (Tournament Name)"
 *  - "Tournament Name (Team A vs Team B)"
 *  - "Tournament Name: Team A vs Team B"
 *  - Automatic franchise-to-tournament inference (e.g., "Adelaide Strikers Women vs Sydney Sixers Women" -> WBBL)
 */
export function parseEventEntities(rawTitle: string, rawCompetition?: string): ParsedEventEntities {
  const trimmed = rawTitle.replace(/\s+/g, " ").trim();
  const matchNumberTag = extractMatchNumberTag(trimmed);
  const matchStage = extractMatchStage(trimmed);

  // Detect any known tournament in the title or competition field
  let detectedTournament: TournamentInfo | null = null;
  const tournamentSearchText = rawCompetition ? `${trimmed} ${rawCompetition}` : trimmed;
  for (const sig of TOURNAMENT_SIGNATURES) {
    if (sig.pattern.test(tournamentSearchText)) {
      detectedTournament = sig.info;
      break;
    }
  }

  // Pre-process bracketed expressions: e.g. "ICC World Test Championship (Pakistan vs Sri Lanka)"
  let candidateVsText = trimmed;
  const bracketMatch = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (bracketMatch) {
    const outside = bracketMatch[1].trim();
    const inside = bracketMatch[2].trim();
    const vsCheck = /\b(?:vs\.?|v\/s|v)\b/i;

    if (vsCheck.test(inside) && !vsCheck.test(outside)) {
      candidateVsText = inside;
      if (!detectedTournament && outside.length > 2) {
        detectedTournament = {
          id: `tourn_${outside.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}`,
          name: outside,
          shortName: outside.length > 16 ? outside.slice(0, 16).trim() : outside,
          category: "Sports Tournament",
        };
      }
    } else if (vsCheck.test(outside) && !vsCheck.test(inside)) {
      candidateVsText = outside;
      if (!detectedTournament && inside.length > 2) {
        detectedTournament = {
          id: `tourn_${inside.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}`,
          name: inside,
          shortName: inside.length > 16 ? inside.slice(0, 16).trim() : inside,
          category: "Sports Tournament",
        };
      }
    }
  }

  // Also handle "Tournament: Team A vs Team B" or "Tournament - Team A vs Team B"
  if (!bracketMatch && /[:|]/.test(candidateVsText)) {
    const colonParts = candidateVsText.split(/[:|]/).map((s) => s.trim()).filter(Boolean);
    const vsCheck = /\b(?:vs\.?|v\/s|v)\b/i;
    const partWithVsIdx = colonParts.findIndex((p) => vsCheck.test(p));
    if (partWithVsIdx !== -1) {
      const otherPart = colonParts[partWithVsIdx === 0 ? 1 : 0];
      candidateVsText = colonParts[partWithVsIdx];
      const isGenericPrefix = /^(?:live|match\s*\d*|stream|hd|fhd|uhd|today|sports?)$/i.test(
        otherPart || ""
      );
      if (!detectedTournament && otherPart && otherPart.length > 2 && !isGenericPrefix) {
        detectedTournament = {
          id: `tourn_${otherPart.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}`,
          name: otherPart,
          shortName: otherPart.length > 16 ? otherPart.slice(0, 16).trim() : otherPart,
          category: "Sports Tournament",
        };
      }
    }
  }

  // Strip leading "Match 1 - " or "1st ODI - " prefix before splitting teams
  candidateVsText = candidateVsText.replace(
    /^(?:match\s*\d+|\d+(?:st|nd|rd|th)\s*(?:t20i?|odi|test|match))\s*[-–:]\s*/i,
    ""
  );

  // Check if there is a head-to-head separator: "vs", "v/s", "v", "/"
  const vsRegex = /^(.+?)\s+(?:vs\.?|v\/s|v|\/)\s+(.+?)$/i;
  const match = candidateVsText.match(vsRegex);

  if (match) {
    const rawSideA = match[1].replace(/^[-:|\s]+|[-:|\s]+$/g, "").trim();
    const rawSideB = match[2]
      .replace(/\s*[-|([]\s*(live|hd|fhd|uhd|stream|1st|2nd|3rd|test|odi|t20).*$/i, "")
      .replace(/^[-:|\s]+|[-:|\s]+$/g, "")
      .trim();

    let teamA = normalizeTeam(rawSideA);
    let teamB = normalizeTeam(rawSideB);

    const isSameTeam =
      teamA.code.toLowerCase() === teamB.code.toLowerCase() ||
      teamA.name.toLowerCase() === teamB.name.toLowerCase();

    const isTournamentNameAsTeam = TOURNAMENT_SIGNATURES.some(
      (sig) => sig.pattern.test(teamA.name) || sig.pattern.test(teamB.name)
    );

    const isNoiseOrChannelSuffix =
      /^(?:hd|fhd|uhd|4k|sd|live|stream|tv|plus|max|\d+|hindi|english|tamil|telugu|astro|willow|sony|star|ten|sky|tnt|espn|ptv|geo|dd)$/i.test(
        rawSideB
      ) ||
      /^(?:sony|star|sky|tnt|espn|willow|astro|bein|supersport|eurosport|dd\s+sports|ptv\s+sports|ten\s+sports)/i.test(
        rawSideA
      );

    if (!isSameTeam && !isTournamentNameAsTeam && !isNoiseOrChannelSuffix && teamA.name && teamB.name) {
      // Automatic franchise-to-tournament inference when both teams belong to the same franchise league
      if (!detectedTournament && teamA.leagueId && teamA.leagueId === teamB.leagueId) {
        detectedTournament = TOURNAMENT_BY_ID[teamA.leagueId] || null;
      }

      // If one team has explicit women's designation or tournament is WBBL/WPL, harmonize both teams' gender
      const isWomenTournament =
        detectedTournament?.id === "tourn_wbbl" ||
        detectedTournament?.id === "tourn_wpl" ||
        /\b(women'?s?|wbbl|wpl)\b/i.test(tournamentSearchText);

      if (isWomenTournament || teamA.gender === "women" || teamB.gender === "women") {
        // Upgrade tournament from BBL -> WBBL or IPL -> WPL if teams/context indicate Women's match
        if (detectedTournament?.id === "tourn_bbl") {
          detectedTournament = TOURNAMENT_BY_ID["tourn_wbbl"];
        } else if (detectedTournament?.id === "tourn_ipl") {
          detectedTournament = TOURNAMENT_BY_ID["tourn_wpl"];
        }
        teamA = promoteTeamToWomenIfContextMatches(teamA, detectedTournament?.id);
        teamB = promoteTeamToWomenIfContextMatches(teamB, detectedTournament?.id);
        if (!detectedTournament && teamA.leagueId && teamA.leagueId === teamB.leagueId) {
          detectedTournament = TOURNAMENT_BY_ID[teamA.leagueId] || null;
        }
      }

      const finalTournament =
        detectedTournament ||
        (rawCompetition
          ? {
              id: `tourn_${rawCompetition.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}`,
              name: rawCompetition,
              shortName: rawCompetition.slice(0, 16).trim(),
              category: "Sports Tournament",
            }
          : null);

      const matchFormat = extractMatchFormat(tournamentSearchText, finalTournament);
      const knownA = Boolean(TEAM_ALIASES[teamA.code.toLowerCase()] || TEAM_ALIASES[teamA.name.toLowerCase()]);
      const knownB = Boolean(TEAM_ALIASES[teamB.code.toLowerCase()] || TEAM_ALIASES[teamB.name.toLowerCase()]);
      const eventConfidence = knownA && knownB ? (finalTournament ? 0.98 : 0.94) : 0.82;

      return {
        kind: "match",
        cleanTitle: `${teamA.name} vs ${teamB.name}`,
        teams: { teamA, teamB },
        tournament: finalTournament,
        matchNumberTag,
        matchFormat,
        matchStage,
        eventConfidence,
      };
    }
  }

  // Otherwise, treat as a tournament / league / channel broadcast without fake teams
  const cleanTitle = detectedTournament
    ? detectedTournament.name
    : trimmed.replace(/\b(\w+)\s+vs\.?\s+\1\b/i, "$1").trim();

  if (!detectedTournament) {
    detectedTournament = {
      id: `tourn_${cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}`,
      name: cleanTitle,
      shortName: cleanTitle.length > 15 ? cleanTitle.slice(0, 15).trim() : cleanTitle,
      category: "Live Broadcast",
    };
  }

  return {
    kind: "tournament_channel",
    cleanTitle,
    teams: null,
    tournament: detectedTournament,
    matchNumberTag,
    matchFormat: extractMatchFormat(tournamentSearchText, detectedTournament),
    matchStage,
    eventConfidence: 0.9,
  };
}

/**
 * Multi-format Date Parser:
 * Handles:
 *  - DD/MM/YYYY HH:mm:ss (PlayZTV, LivXow, SKTech: e.g. "10/11/2026 09:30:00")
 *  - YYYY/MM/DD HH:mm:ss Z (Cricify, Sportzx: e.g. "2026/11/10 14:00:00 +0000")
 *  - Standard ISO 8601 strings ("2026-11-10T14:00:00.000Z")
 */
export function parseCanonicalDate(startTime?: string): string {
  if (!startTime) {
    return new Date().toISOString().slice(0, 10);
  }

  const trimmed = startTime.trim();

  // Pattern 1: DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Pattern 2: YYYY/MM/DD or YYYY-MM-DD
  const ymdMatch = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, "0");
    const day = ymdMatch[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  try {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  } catch {}

  return new Date().toISOString().slice(0, 10);
}

/**
 * Normalizes any provider timestamp into a valid ISO 8601 string
 */
export function safeIsoDate(rawDate?: string): string | null {
  if (!rawDate) return null;
  const trimmed = rawDate.trim();

  const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    const time = dmyMatch[4]
      ? dmyMatch[4].length === 5
        ? `${dmyMatch[4]}:00`
        : dmyMatch[4]
      : "00:00:00";
    return `${year}-${month}-${day}T${time}.000Z`;
  }

  const ymdMatch = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/);
  if (ymdMatch && !trimmed.includes("T")) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, "0");
    const day = ymdMatch[3].padStart(2, "0");
    const time = ymdMatch[4]
      ? ymdMatch[4].length === 5
        ? `${ymdMatch[4]}:00`
        : ymdMatch[4]
      : "00:00:00";
    return `${year}-${month}-${day}T${time}.000Z`;
  }

  try {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString();
    }
  } catch {}

  return null;
}

/**
 * Generates an Order-Independent Canonical Key
 * Example for Match: `cricket::ind-vs-nz::2026-11-09`
 * Example for Tournament: `cricket::nepal-premier-league::2026`
 */
export function generateCanonicalKey(
  sport: SportCategory,
  parsed: ParsedEventEntities,
  startTime?: string
): string {
  const datePart = parseCanonicalDate(startTime);
  const yearPart = datePart.slice(0, 4);

  if (parsed.kind === "match" && parsed.teams) {
    const codes = [
      parsed.teams.teamA.code.toLowerCase(),
      parsed.teams.teamB.code.toLowerCase(),
    ].sort();
    return `${sport}::${codes[0]}-vs-${codes[1]}::${datePart}`;
  }

  const slug = (parsed.tournament?.name || parsed.cleanTitle)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${sport}::${slug || "broadcast"}::${yearPart}`;
}

/**
 * Detects audio/commentary language from stream title or metadata
 */
export function detectLanguage(text: string): LanguageInfo {
  const lower = text.toLowerCase();
  if (/\b(hindi|\bhin\b)\b/.test(lower)) return { code: "hin", name: "Hindi", badge: "HIN" };
  if (/\b(tamil|\btam\b)\b/.test(lower)) return { code: "tam", name: "Tamil", badge: "TAM" };
  if (/\b(telugu|\btel\b)\b/.test(lower)) return { code: "tel", name: "Telugu", badge: "TEL" };
  if (/\b(nepali|\bnep\b)\b/.test(lower)) return { code: "nep", name: "Nepali", badge: "NEP" };
  if (/\b(urdu|\burd\b)\b/.test(lower)) return { code: "urd", name: "Urdu", badge: "URD" };
  if (/\b(bengali|bangla|\bben\b)\b/.test(lower)) return { code: "ben", name: "Bengali", badge: "BEN" };
  if (/\b(malayalam|\bmal\b)\b/.test(lower)) return { code: "mal", name: "Malayalam", badge: "MAL" };
  if (/\b(kannada|\bkan\b)\b/.test(lower)) return { code: "kan", name: "Kannada", badge: "KAN" };
  if (/\b(marathi|\bmar\b)\b/.test(lower)) return { code: "mar", name: "Marathi", badge: "MAR" };
  if (/\b(gujarati|\bguj\b)\b/.test(lower)) return { code: "guj", name: "Gujarati", badge: "GUJ" };
  if (/\b(punjabi|\bpan\b)\b/.test(lower)) return { code: "pan", name: "Punjabi", badge: "PAN" };
  if (/\b(arabic|\bara\b)\b/.test(lower)) return { code: "ara", name: "Arabic", badge: "ARA" };
  if (/\b(spanish|espanol|\bspa\b)\b/.test(lower)) return { code: "spa", name: "Spanish", badge: "SPA" };
  return { code: "eng", name: "English", badge: "ENG" };
}

/**
 * Extracts broadcaster / network name from title or URL
 */
export function detectBroadcaster(title: string, url: string): string {
  const combined = `${title} ${url}`.toLowerCase();
  if (combined.includes("star sports")) return "Star Sports Network";
  if (combined.includes("sony ten") || combined.includes("sony liv") || combined.includes("sonyliv"))
    return "Sony Sports Network";
  if (combined.includes("jio") || combined.includes("jiocinema") || combined.includes("jiotv"))
    return "JioCinema / Sports18";
  if (combined.includes("willow")) return "Willow TV";
  if (combined.includes("sky sports")) return "Sky Sports";
  if (combined.includes("tnt sports") || combined.includes("bt sport")) return "TNT Sports";
  if (combined.includes("fancode")) return "FanCode";
  if (combined.includes("astro")) return "Astro SuperSport";
  if (combined.includes("bein")) return "beIN Sports";
  if (combined.includes("espn")) return "ESPN";
  if (combined.includes("a sports") || combined.includes("ary")) return "A Sports HD";
  if (combined.includes("ptv")) return "PTV Sports";
  if (combined.includes("ten sports")) return "Ten Sports";
  if (combined.includes("kantipur")) return "Kantipur Max HD";
  if (combined.includes("t sports") || combined.includes("tsports")) return "T Sports";
  if (combined.includes("prime") || combined.includes("aiv-cdn")) return "Prime Video Live";
  if (combined.includes("supersport")) return "SuperSport";
  if (combined.includes("fox")) return "Fox Sports";
  if (combined.includes("dazn")) return "DAZN";
  return "Direct Sports Feed";
}

const EPHEMERAL_QUERY_PARAMS = new Set([
  "_",
  "cb",
  "cachebuster",
  "rand",
  "random",
  "nocache",
  "utm_source",
  "utm_medium",
  "utm_campaign",
]);

/**
 * Normalizes a stream URL for lossless cross-provider deduplication:
 * - Strips inline pipe metadata (`|Referer=...`)
 * - Lowercases scheme and hostname, strips default ports (`:80`, `:443`)
 * - Normalizes duplicate/trailing path slashes
 * - Strips ephemeral cache-buster query parameters while preserving stream-identifying & token parameters
 */
export function normalizeStreamUrlForDedup(rawUrl: string): string {
  const cleanUrl = rawUrl.split("|")[0].trim();
  if (!cleanUrl) return "";
  try {
    const parsed = new URL(cleanUrl);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    if (
      (parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")
    ) {
      parsed.port = "";
    }
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    const keptEntries: [string, string][] = [];
    for (const [k, v] of parsed.searchParams.entries()) {
      if (!EPHEMERAL_QUERY_PARAMS.has(k.toLowerCase())) {
        keptEntries.push([k, v]);
      }
    }
    keptEntries.sort((a, b) => a[0].localeCompare(b[0]));
    parsed.search = "";
    for (const [k, v] of keptEntries) {
      parsed.searchParams.append(k, v);
    }
    return parsed.toString();
  } catch {
    return cleanUrl;
  }
}

/**
 * Checks whether two YYYY-MM-DD date strings are within 1 calendar day (36 hours) of each other
 * to safely handle UTC vs IST/local timezone rollovers without merging matches days apart.
 */
function areDatesAdjacentOrSame(dateA: string, dateB: string): boolean {
  if (dateA === dateB) return true;
  const msA = Date.parse(`${dateA}T00:00:00Z`);
  const msB = Date.parse(`${dateB}T00:00:00Z`);
  if (Number.isNaN(msA) || Number.isNaN(msB)) return false;
  return Math.abs(msA - msB) <= 36 * 3600 * 1000;
}

/**
 * Converts a list of raw `LiveEvent` records into a deduplicated, normalized `NormalizedCatalogFixture[]` catalog.
 */
export function buildUnifiedCatalog(events: LiveEvent[]): NormalizedCatalogFixture[] {
  interface InternalFixtureBucket {
    fixture: NormalizedCatalogFixture;
    hasExplicitStartTime: boolean;
    matchNumberTag: string | null;
    rawUrls: Set<string>;
  }

  const fixtureMap = new Map<string, InternalFixtureBucket>();
  // Secondary index by `sport::codeA-vs-codeB` for O(1) candidate lookup instead of O(N) scan
  const teamPairIndex = new Map<string, string[]>();

  for (const ev of events) {
    const sport = detectSport(ev.category, ev.title);
    const parsed = parseEventEntities(ev.title, ev.competition);
    let canonicalKey = generateCanonicalKey(sport, parsed, ev.startTime);

    let bucket = fixtureMap.get(canonicalKey);

    if (!bucket && parsed.kind === "match" && parsed.teams) {
      const codes = [
        parsed.teams.teamA.code.toLowerCase(),
        parsed.teams.teamB.code.toLowerCase(),
      ].sort();
      const teamPairKey = `${sport}::${codes[0]}-vs-${codes[1]}`;
      const existingKeys = teamPairIndex.get(teamPairKey) || [];
      const evDate = parseCanonicalDate(ev.startTime);
      const evHasExplicitDate = Boolean(ev.startTime && ev.startTime.trim());

      for (const candidateKey of existingKeys) {
        const candidateBucket = fixtureMap.get(candidateKey);
        if (!candidateBucket) continue;

        // Never merge if both have explicit match numbers and they differ (e.g., 1st ODI vs 2nd ODI)
        if (
          parsed.matchNumberTag &&
          candidateBucket.matchNumberTag &&
          parsed.matchNumberTag !== candidateBucket.matchNumberTag
        ) {
          continue;
        }

        const candidateDate = candidateKey.split("::")[2] || "";
        // Coalesce if at least one event lacked an explicit startTime OR if their dates are adjacent (<=1 day timezone shift)
        if (
          !evHasExplicitDate ||
          !candidateBucket.hasExplicitStartTime ||
          areDatesAdjacentOrSame(evDate, candidateDate)
        ) {
          bucket = candidateBucket;
          canonicalKey = candidateKey;
          break;
        }
      }
    }

    const providersInEvent = Array.from(new Set(ev.sources.map((s) => s.provider)));
    const languagesInEvent = Array.from(
      new Set(ev.sources.map((s) => detectLanguage(`${ev.title} ${s.title || ""} ${s.quality}`).code))
    );
    const broadcastersInEvent = Array.from(
      new Set(ev.sources.map((s) => detectBroadcaster(s.title || ev.title, s.streamUrl)))
    );

    const mappedStatus: "live" | "upcoming" | "ended" =
      ev.status === "LIVE" ? "live" : ev.status === "ENDED" ? "ended" : "upcoming";

    if (!bucket) {
      const fixtureId = `fix_${createHash("md5").update(canonicalKey).digest("hex").slice(0, 12)}`;
      const pointerMap: Record<string, string> = {};
      for (const p of providersInEvent) {
        pointerMap[p] = ev.id;
      }

      const rawUrls = new Set<string>();
      for (const s of ev.sources) {
        const dedupUrl = normalizeStreamUrlForDedup(s.streamUrl);
        if (dedupUrl) rawUrls.add(dedupUrl);
      }

      const newFixture: NormalizedCatalogFixture = {
        fixtureId,
        canonicalKey,
        kind: parsed.kind,
        sport,
        title: parsed.cleanTitle,
        matchFormat: parsed.matchFormat || null,
        matchStage: parsed.matchStage || null,
        matchNumberTag: parsed.matchNumberTag || null,
        eventConfidence: parsed.eventConfidence ?? 0.9,
        tournament: parsed.tournament,
        teams: parsed.teams,
        broadcastInfo:
          parsed.kind === "tournament_channel"
            ? {
                channelName: parsed.cleanTitle,
                broadcaster: broadcastersInEvent[0] || "Sports Network",
                is24x7: false,
              }
            : null,
        schedule: {
          status: mappedStatus,
          isLive: ev.status === "LIVE",
          startTimeUtc: safeIsoDate(ev.startTime),
          endTimeUtc: safeIsoDate(ev.endTime),
        },
        posterUrl: ev.poster || null,
        streamMetadata: {
          totalWorkingFeeds: rawUrls.size,
          availableLanguages: languagesInEvent.length > 0 ? languagesInEvent : ["eng"],
          availableQualities: ["1080p", "720p", "480p", "360p"],
          maxResolution: "1080p FHD",
          primaryBroadcasters: broadcastersInEvent,
          hasDrmFeeds: ev.sources.some((s) => Boolean(s.drm)),
        },
        providerPointers: pointerMap,
      };

      bucket = {
        fixture: newFixture,
        hasExplicitStartTime: Boolean(ev.startTime && ev.startTime.trim()),
        matchNumberTag: parsed.matchNumberTag || null,
        rawUrls,
      };
      fixtureMap.set(canonicalKey, bucket);

      if (parsed.kind === "match" && parsed.teams) {
        const codes = [
          parsed.teams.teamA.code.toLowerCase(),
          parsed.teams.teamB.code.toLowerCase(),
        ].sort();
        const teamPairKey = `${sport}::${codes[0]}-vs-${codes[1]}`;
        const list = teamPairIndex.get(teamPairKey) || [];
        list.push(canonicalKey);
        teamPairIndex.set(teamPairKey, list);
      }
    } else {
      const existing = bucket.fixture;

      // Merge provider pointers
      for (const p of providersInEvent) {
        if (!existing.providerPointers[p]) {
          existing.providerPointers[p] = ev.id;
        }
      }

      // Merge unique stream URLs for accurate totalWorkingFeeds count
      for (const s of ev.sources) {
        const dedupUrl = normalizeStreamUrlForDedup(s.streamUrl);
        if (dedupUrl) bucket.rawUrls.add(dedupUrl);
      }
      existing.streamMetadata.totalWorkingFeeds = bucket.rawUrls.size;

      // Merge languages & broadcasters
      existing.streamMetadata.availableLanguages = Array.from(
        new Set([...existing.streamMetadata.availableLanguages, ...languagesInEvent])
      );
      existing.streamMetadata.primaryBroadcasters = Array.from(
        new Set([...existing.streamMetadata.primaryBroadcasters, ...broadcastersInEvent])
      );
      if (ev.sources.some((s) => Boolean(s.drm))) {
        existing.streamMetadata.hasDrmFeeds = true;
      }

      // Upgrade tournament & match metadata if missing
      if (!existing.tournament && parsed.tournament) {
        existing.tournament = parsed.tournament;
      }
      if (!existing.matchFormat && parsed.matchFormat) {
        existing.matchFormat = parsed.matchFormat;
      }
      if (!existing.matchStage && parsed.matchStage) {
        existing.matchStage = parsed.matchStage;
      }
      if (!existing.matchNumberTag && parsed.matchNumberTag) {
        existing.matchNumberTag = parsed.matchNumberTag;
      }

      // Upgrade schedule status (live > upcoming > ended) and timestamps
      if (ev.status === "LIVE") {
        existing.schedule.isLive = true;
        existing.schedule.status = "live";
      } else if (ev.status === "UPCOMING" && existing.schedule.status === "ended") {
        existing.schedule.status = "upcoming";
      }
      if (!existing.schedule.startTimeUtc && ev.startTime) {
        existing.schedule.startTimeUtc = safeIsoDate(ev.startTime);
      }
      if (!existing.schedule.endTimeUtc && ev.endTime) {
        existing.schedule.endTimeUtc = safeIsoDate(ev.endTime);
      }
      if (!existing.posterUrl && ev.poster) {
        existing.posterUrl = ev.poster;
      }
      if (!bucket.matchNumberTag && parsed.matchNumberTag) {
        bucket.matchNumberTag = parsed.matchNumberTag;
      }
      if (ev.startTime && ev.startTime.trim()) {
        bucket.hasExplicitStartTime = true;
      }
    }
  }

  return Array.from(fixtureMap.values()).map((b) => b.fixture);
}

/**
 * Generates pre-parsed multi-bitrate RenditionVariants for a master stream URL
 */
export function buildPreParsedRenditions(
  masterUrl: string,
  protocol: "hls" | "dash",
  proxyBaseUrl: string,
  headers?: Record<string, string>
): RenditionVariant[] {
  const headerQuery = buildProxyHeaderQuery(headers);
  const encodedMaster = encodeURIComponent(masterUrl);

  return [
    {
      qualityTag: "AUTO",
      resolution: "Adaptive",
      height: 1080,
      bandwidthKbps: 6500,
      fps: 50,
      codec: "avc1.640028, mp4a.40.2",
      url: `${proxyBaseUrl}?url=${encodedMaster}&quality=auto${headerQuery}`,
      isDefault: true,
    },
    {
      qualityTag: "1080p",
      resolution: "1920x1080",
      height: 1080,
      bandwidthKbps: 5800,
      fps: 50,
      codec: "avc1.640028",
      url: `${proxyBaseUrl}?url=${encodedMaster}&quality=1080p${headerQuery}`,
      isDefault: false,
    },
    {
      qualityTag: "720p",
      resolution: "1280x720",
      height: 720,
      bandwidthKbps: 3200,
      fps: 50,
      codec: "avc1.4d401f",
      url: `${proxyBaseUrl}?url=${encodedMaster}&quality=720p${headerQuery}`,
      isDefault: false,
    },
    {
      qualityTag: "480p",
      resolution: "854x480",
      height: 480,
      bandwidthKbps: 1500,
      fps: 25,
      codec: "avc1.42c01e",
      url: `${proxyBaseUrl}?url=${encodedMaster}&quality=480p${headerQuery}`,
      isDefault: false,
    },
    {
      qualityTag: "360p",
      resolution: "640x360",
      height: 360,
      bandwidthKbps: 800,
      fps: 25,
      codec: "avc1.42c015",
      url: `${proxyBaseUrl}?url=${encodedMaster}&quality=360p${headerQuery}`,
      isDefault: false,
    },
  ];
}

/**
 * Deduplicates raw `StreamSource[]` across providers for a fixture,
 * merges ClearKey DRM and HTTP headers across mirrors, and builds `RichStreamFeed[]`.
 */
export function buildRichStreamFeeds(
  sources: StreamSource[],
  proxyBaseUrl = "http://localhost:3000/api/proxy"
): RichStreamFeed[] {
  const urlGroupMap = new Map<string, StreamSource[]>();

  for (const src of sources) {
    const parsedPipe = parsePipeStreamUrl(src.streamUrl, src.headers, src.drm);
    if (
      !parsedPipe.cleanUrl ||
      parsedPipe.cleanUrl.startsWith("playztv://") ||
      parsedPipe.cleanUrl.startsWith("livxow://") ||
      parsedPipe.cleanUrl.startsWith("sktech://")
    ) {
      continue;
    }

    const normalizedSrc: StreamSource = {
      ...src,
      streamUrl: parsedPipe.cleanUrl,
      headers: Object.keys(parsedPipe.headers).length > 0 ? parsedPipe.headers : undefined,
      drm: parsedPipe.drm,
    };

    const dedupKey = normalizeStreamUrlForDedup(parsedPipe.cleanUrl);
    const existingList = urlGroupMap.get(dedupKey);
    if (existingList) {
      existingList.push(normalizedSrc);
    } else {
      urlGroupMap.set(dedupKey, [normalizedSrc]);
    }
  }

  const feeds: RichStreamFeed[] = [];
  let index = 0;

  for (const [, group] of urlGroupMap.entries()) {
    // Sort group by provider trust rank descending
    group.sort((a, b) => {
      const scoreA = PROVIDER_TRUST_RANK[a.provider]?.score ?? 75;
      const scoreB = PROVIDER_TRUST_RANK[b.provider]?.score ?? 75;
      return scoreB - scoreA;
    });

    const primarySource = group[0];
    const rawUrl = primarySource.streamUrl;
    const uniqueProviders = Array.from(new Set(group.map((s) => s.provider)));
    const primaryProvider = uniqueProviders[0];
    const mirroredProviders = uniqueProviders.slice(1);
    const isMultiSource = uniqueProviders.length > 1;

    // Merge headers and DRM across all contributing sources in the group
    let mergedHeaders: Record<string, string> = {};
    let mergedDrm = primarySource.drm;
    let bestTitle = primarySource.title || primarySource.quality;

    for (const s of group) {
      if (s.headers) {
        mergedHeaders = { ...s.headers, ...mergedHeaders };
      }
      if (s.drm) {
        mergedDrm = DrmHelper.mergeDrm(mergedDrm, s.drm);
      }
      if (
        s.title &&
        s.title.length > (bestTitle?.length || 0) &&
        s.title !== "1080p" &&
        s.title !== "720p"
      ) {
        bestTitle = s.title;
      }
    }

    const primaryDisplay = PROVIDER_TRUST_RANK[primaryProvider]?.displayName || primaryProvider;
    const attributionBadge = isMultiSource
      ? `Multi-Source (${primaryDisplay} + ${mirroredProviders.length} Mirror${
          mirroredProviders.length > 1 ? "s" : ""
        })`
      : `Exclusive to ${primaryDisplay}`;

    const baseTrust = PROVIDER_TRUST_RANK[primaryProvider]?.score ?? 85;
    const reliabilityScore = Math.min(99, baseTrust + mirroredProviders.length * 2);

    const protocol =
      primarySource.format === "DASH" || rawUrl.toLowerCase().includes(".mpd") ? "dash" : "hls";
    const broadcaster = detectBroadcaster(bestTitle || "", rawUrl);
    const language = detectLanguage(`${bestTitle || ""} ${primarySource.quality} ${rawUrl}`);

    const streamHash = createHash("sha256").update(rawUrl).digest("hex").slice(0, 12);
    const hasHeaders = Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined;
    const headerQuery = buildProxyHeaderQuery(hasHeaders);

    feeds.push({
      streamId: `str_${streamHash}`,
      channelName:
        bestTitle && bestTitle !== "1080p" && bestTitle !== "720p"
          ? bestTitle
          : `${broadcaster} (${language.badge})`,
      channelGroup: broadcaster,
      priorityTier: index === 0 ? "primary" : index <= 2 ? "backup" : "fallback",
      reliabilityScore,
      language,
      protocol,
      drm: mergedDrm ? { type: mergedDrm.type, clearKeys: mergedDrm.clearKeys } : null,
      network: {
        masterPlaylistUrl: rawUrl,
        edgeProxyFallbackUrl: `${proxyBaseUrl}?url=${encodeURIComponent(rawUrl)}${headerQuery}`,
        headers: hasHeaders,
      },
      provenance: {
        isMultiSource,
        primaryProvider,
        mirroredProviders,
        sourceList: group.map((g, idx) => ({
          providerKey: g.provider,
          providerId: g.provider,
          providerName: PROVIDER_TRUST_RANK[g.provider]?.displayName || g.provider,
          isPrimary: idx === 0,
          discoveredAt: g.timestamp || new Date().toISOString(),
        })),
        attributionBadge,
      },
      hasPreParsedRenditions: true,
      renditions: buildPreParsedRenditions(rawUrl, protocol, proxyBaseUrl, hasHeaders),
    });

    index++;
  }

  // Sort feeds by reliabilityScore descending
  feeds.sort((a, b) => b.reliabilityScore - a.reliabilityScore);

  // Re-assign priority tiers after sort
  feeds.forEach((f, idx) => {
    f.priorityTier = idx === 0 ? "primary" : idx <= 2 ? "backup" : "fallback";
  });

  return feeds;
}
