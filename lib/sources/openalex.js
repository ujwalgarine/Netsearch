// OpenAlex (openalex.org), a free and open (CC0) catalog of research papers: a researcher's
// latest papers, looked up by the ORCID iD they linked. One call per person. Without a key all
// callers on one IP share a small daily budget; a free OPENALEX_API_KEY gives each app its own.

const API = 'https://api.openalex.org';
const FIELDS = 'id,display_name,publication_date,cited_by_count,doi,primary_location,type';

export async function openalexWorks(ctx, orcid, count = 6) {
  const key = ctx.openalexKey ? `&api_key=${encodeURIComponent(ctx.openalexKey)}` : '';
  const data = await ctx.fetchJson(
    `${API}/works?filter=author.orcid:${encodeURIComponent(orcid)}&sort=publication_date:desc&per_page=${count}&select=${FIELDS}${key}`,
  );
  return (data?.results ?? [])
    .filter((w) => w?.display_name)
    .map((w) => ({
      title: w.display_name,
      url: w.doi || w.primary_location?.landing_page_url || w.id,
      date: w.publication_date ?? null,
      venue: w.primary_location?.source?.display_name ?? '',
      citations: w.cited_by_count ?? 0,
      type: w.type ?? '',
    }));
}
