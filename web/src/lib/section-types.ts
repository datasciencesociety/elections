export type SectionTypeKey = "normal" | "hospital" | "prison" | "mobile" | "abroad";

export const SECTION_TYPE_LABELS: Record<SectionTypeKey, string> = {
  normal: "Обикновени",
  hospital: "Болница",
  prison: "Затвор",
  mobile: "Подвижна",
  abroad: "Чужбина",
};

export const ALL_SECTION_TYPES: SectionTypeKey[] = [
  "normal",
  "hospital",
  "prison",
  "mobile",
  "abroad",
];

/** "Special" = sections where voting conditions differ from regular polling
 *  stations (hospitals, prisons, mobile ballot boxes, overseas). Statistical
 *  methods don't apply cleanly to these. */
export const SPECIAL_SECTION_TYPES: SectionTypeKey[] = [
  "hospital",
  "prison",
  "mobile",
  "abroad",
];

