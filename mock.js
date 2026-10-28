// Demo data used when no OpenAI key is set, so the interface can be tried right away.
// People here are obvious placeholders with no profile links; real people need the API keys.

export function mockPlan(prompt, map) {
  if (map?.branches?.length) {
    // Follow-ups keep the current (possibly hand-edited) map as is.
    return {
      reply: "Demo mode can't change the map from chat. Edit branches directly, or add an OpenAI key to .env.",
      goal: map.goal,
      profile: map.profile ?? '',
      branches: map.branches.map((b) => ({ id: b.id, label: b.label, why: b.why, query: b.query, refresh: false })),
    };
  }

  const goal = prompt.trim().replace(/\s+/g, ' ');
  return {
    reply:
      "Here's a first map (demo data, since no OpenAI key is set yet). Tell me your school, field, and target companies and I'll tighten it.",
    goal: goal.length > 48 ? `${goal.slice(0, 45)}…` : goal,
    profile: goal,
    branches: [
      {
        id: '',
        label: 'Alumni at target companies',
        why: 'Shared school ties get the highest reply rates on cold outreach.',
        query: 'professional profiles of University of Washington alumni working as product managers at Microsoft',
        refresh: true,
      },
      {
        id: '',
        label: 'Upperclassmen in your major',
        why: 'Closest to your situation and the easiest to reach.',
        query: 'professional profiles of University of Washington Informatics seniors with big-tech internships',
        refresh: true,
      },
      {
        id: '',
        label: 'Recruiters & program leads',
        why: 'They decide who gets into early-career programs.',
        query: 'professional profiles of university recruiters for early-career programs at Microsoft',
        refresh: true,
      },
    ],
  };
}

export function mockPeople(label, offset, count) {
  return Array.from({ length: Math.min(count, 3) }, (_, i) => {
    const n = offset + i + 1;
    return {
      id: `demo-${label}-${n}`,
      name: `Sample person ${n}`,
      headline: `Demo profile · ${label}`,
      location: null,
      url: null,
      image: null,
      summary: 'Placeholder. With OPENAI_API_KEY and EXA_API_KEY set, this shows a real person found by people search.',
      why: 'Demo data so you can try editing, merging, and moving people around.',
      in_common: [],
      talking_points: ['Real talking points are written from the person’s actual profile once the API keys are set.'],
      experience: [],
      education: [],
    };
  });
}
