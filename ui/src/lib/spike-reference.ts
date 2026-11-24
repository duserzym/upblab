/** Only known source keys may supply external links; never turn locators into URLs. */
export const spikeDois: ReadonlyMap<string, string> = new Map([
  ['condon2015', 'https://doi.org/10.1016/j.gca.2015.05.026'],
]);

/** Shorten only recognizable author/year citations, not workbook labels or paths. */
export function shortCitation(text: string): string {
  const author = text.match(/^([\p{L}][\p{L}'’\-]+)(?:(?:,\s*|\s+)[A-Z]\.|\s+et al\.)/u);
  const year = text.match(/\b(?:19|20)\d{2}\b/);
  const authors = text.slice(0, year?.index);
  return author && year && (/\bet al\./.test(authors) || /,\s*[\p{L}][\p{L}'’\-]+(?:,\s*|\s+)[A-Z]\./u.test(authors.slice(author[0].length)))
    ? `${author[1]} et al. ${year[0]}` : text;
}
