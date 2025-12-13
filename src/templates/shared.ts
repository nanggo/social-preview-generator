export interface CenteredTitleDescriptionLayout {
  contentStartY: number;
  titleStartY: number;
  descStartY: number;
  titleHeight: number;
  descHeight: number;
  totalContentHeight: number;
  gap: number;
}

export function measureTextBlockHeight(lineCount: number, fontSize: number, lineHeight: number): number {
  return lineCount * fontSize * lineHeight;
}

export function layoutCenteredTitleDescription(params: {
  height: number;
  titleLineCount: number;
  titleFontSize: number;
  titleLineHeight: number;
  descLineCount: number;
  descFontSize: number;
  descLineHeight: number;
  gap: number;
}): CenteredTitleDescriptionLayout {
  const titleHeight = measureTextBlockHeight(
    params.titleLineCount,
    params.titleFontSize,
    params.titleLineHeight
  );
  const descHeight =
    params.descLineCount > 0
      ? measureTextBlockHeight(params.descLineCount, params.descFontSize, params.descLineHeight)
      : 0;
  const appliedGap = params.descLineCount > 0 ? params.gap : 0;

  const totalContentHeight = titleHeight + appliedGap + descHeight;
  const contentStartY = (params.height - totalContentHeight) / 2;

  return {
    contentStartY,
    titleStartY: contentStartY + params.titleFontSize,
    descStartY: contentStartY + titleHeight + appliedGap + params.descFontSize,
    titleHeight,
    descHeight,
    totalContentHeight,
    gap: appliedGap,
  };
}

export function createSvgStyleCdata(css: string): string {
  return `
    <style type="text/css">
      <![CDATA[
      ${css.trim()}
      ]]>
    </style>
  `;
}
