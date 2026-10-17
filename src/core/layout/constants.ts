// All values in printer dots.
export const MARGIN = 8        // outer margin inside the card edge
export const FRAME = 3         // card border stroke
export const GAP = 4           // vertical gap between bars
export const NAME_H = 38
export const TYPE_H = 28
export const TEXT_PAD = 6      // padding inside the text box
export const STAT_H = 32       // P/T or loyalty box height
export const STAT_PAD = 10     // horizontal padding inside the stat box
export const ART_MAX = 250
export const ART_MID = 180
export const ART_MIN = 100
export const ART_STEP = 10
export const TEXT_MIN = 14     // readability floor before art shrinks below ART_MID
export const TEXT_FLOOR = 11   // absolute floor; below this we clip
export const NAME_MIN = 14
export const COST_SYMBOL = 24  // symbol size in the name bar
export const LINE_HEIGHT_RATIO = 1.22
export const TYPE_SIZE = 18     // type line base size
export const TYPE_MIN = 11      // type line floor; below this the line is clipped to its bar
// Columns sheets (saga, class, ...): the art is a narrow column beside the text
export const COL_ART_MAX = 150
export const COL_ART_MID = 120
export const COL_ART_MIN = 80
export const COL_ART_STEP = 10
export const BADGE = 22         // chapter / level badge size
export const BADGE_GUTTER = 28  // width reserved left of the text for badges
export const SECTION_GAP = 6    // vertical gap between sections
export const SECTION_RULE = 1   // rule between sections
// Split sheets (two sub-cards stacked on one face)
export const SUB_PAD = 6
export const SUB_TYPE_H = 22
export const SPLIT_ART_MAX = 120
export const SPLIT_ART_MIN = 60
export const SPLIT_ART_STEP = 10
