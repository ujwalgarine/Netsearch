// ORCID public API (pub.orcid.org), no key: a researcher's own record, which lists the jobs,
// works, schools and websites they chose to make public. One call per person. Anonymous use allows
// 25,000 reads a day per IP.

const API = 'https://pub.orcid.org/v3.0';
const v = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x) ?? null;

export async function orcidRecord(ctx, id) {
  const rec = await ctx.fetchJson(`${API}/${encodeURIComponent(id)}/record`);
  if (!rec?.person) return null;
  const name = rec.person.name ?? {};
  const acts = rec['activities-summary'] ?? {};

  const works = (acts.works?.group ?? []).map((g) => {
    const w = g?.['work-summary']?.[0] ?? {};
    const ids = [...(g?.['external-ids']?.['external-id'] ?? []), ...(w['external-ids']?.['external-id'] ?? [])];
    const doi = ids.find((x) => x?.['external-id-type'] === 'doi' && x?.['external-id-relationship'] !== 'part-of')?.['external-id-value'];
    return {
      title: v(w.title?.title) ?? '',
      year: v(w['publication-date']?.year),
      venue: v(w['journal-title']) ?? '',
      type: w.type ?? '',
      url: doi ? `https://doi.org/${String(doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}` : v(w.url),
    };
  }).filter((w) => w.title);

  const affiliations = (group, kind) =>
    (group?.['affiliation-group'] ?? [])
      .flatMap((g) => g?.summaries ?? [])
      .map((s) => s?.[`${kind}-summary`])
      .filter((e) => e?.organization?.name)
      .map((e) => ({
        organization: e.organization.name,
        role: e['role-title'] ?? '',
        department: e['department-name'] ?? '',
        from: v(e['start-date']?.year),
        to: v(e['end-date']?.year),
      }));
  const employments = affiliations(acts.employments, 'employment');
  const educations = affiliations(acts.educations, 'education');

  return {
    id,
    url: `https://orcid.org/${id}`,
    name: [v(name['given-names']), v(name['family-name'])].filter(Boolean).join(' ') || v(name['credit-name']) || '',
    links: (rec.person['researcher-urls']?.['researcher-url'] ?? []).map((u) => v(u?.url)).filter(Boolean),
    works,
    employments,
    educations,
  };
}

// Records whose given and family names match, with the institutions each lists. One call. Used to
// find a researcher who didn't link their ORCID iD; each result still has to be tied to the profile.
export async function orcidSearch(ctx, first, last) {
  const q = `given-names:"${first}" AND family-name:"${last}"`;
  const data = await ctx.fetchJson(`${API}/expanded-search/?q=${encodeURIComponent(q)}&rows=10`);
  return {
    total: data?.['num-found'] ?? 0,
    results: (data?.['expanded-result'] ?? [])
      .filter((r) => r?.['orcid-id'])
      .map((r) => ({ id: r['orcid-id'], name: [r['given-names'], r['family-names']].filter(Boolean).join(' '), institutions: (r['institution-name'] ?? []).map(String) })),
  };
}
