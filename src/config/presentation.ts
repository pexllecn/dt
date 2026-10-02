/** Presentation settings. Neutral product name; no utility or third-party branding. */
export const presentation = {
  productName: 'Cognitive Grid Twin',
  strapline: 'Decision support for the all-island transmission system',
  /** Path to an EY logo under /public, or null to leave the slot empty. */
  partnerLogo: null as string | null,
  partnerLogoAlt: 'EY',
  /** Show a place label for the hypothetical north west large energy user. */
  showHeroPlaceLabel: false,
  dataBadge:
    'Demonstration environment. Network geometry approximate (OpenStreetMap). Telemetry synthetic, calibrated to public figures.',
} as const;
