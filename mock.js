// Demo data used when no OpenAI key is set, so the interface can be tried right away.

export function mockNetwork(prompt) {
  const goal = prompt.trim().replace(/\s+/g, ' ');
  return {
    reply:
      "Here's a first map (demo data, since no OpenAI key is set yet). Tell me your school, field, and target companies and I'll tighten it.",
    goal: goal.length > 48 ? `${goal.slice(0, 45)}…` : goal,
    branches: [
      {
        label: 'Alumni at target companies',
        why: 'Shared school ties get the highest reply rates on cold outreach.',
        connections: [
          {
            title: 'Product Manager (your school alum)',
            organization: 'Microsoft',
            why: 'Went through the same coursework and can explain how they landed the role.',
            talking_points: [
              'Which classes or projects from school actually came up in your PM interviews?',
              'How did your first-year internship search differ from what you expected?',
            ],
            search_query: 'product manager Microsoft University of Washington alumni',
          },
          {
            title: 'Software Engineer, early career',
            organization: 'Amazon',
            why: 'Recently made the jump from student to full-time, so their advice is current.',
            talking_points: [
              'What did you do in your first two years that made the biggest difference?',
              'Which clubs or hackathons were worth the time?',
            ],
            search_query: 'software engineer Amazon new grad University of Washington',
          },
        ],
      },
      {
        label: 'Upperclassmen in your major',
        why: 'Closest to your situation and the easiest to reach.',
        connections: [
          {
            title: 'Senior with a big-tech internship',
            organization: 'Your department',
            why: 'Can share exactly how they prepared and who referred them.',
            talking_points: [
              'How early did you start applying for your first internship?',
              'Is there anyone you’d suggest I talk to next?',
            ],
            search_query: 'informatics senior intern University of Washington',
          },
          {
            title: 'Officer of a student tech club',
            organization: 'Campus clubs',
            why: 'Club leaders know recruiters and run events you can show up to.',
            talking_points: [
              'What does it take to get involved on the leadership side?',
              'Which company events this quarter would you recommend?',
            ],
            search_query: 'president student technology club University of Washington',
          },
        ],
      },
      {
        label: 'Recruiters & program leads',
        why: 'They decide who gets into early-career programs.',
        connections: [
          {
            title: 'University Recruiter, early-career programs',
            organization: 'Microsoft',
            why: 'Owns the internship pipeline for first- and second-year students.',
            talking_points: [
              'What separates strong first-year applicants from the rest?',
              'Are there campus events where I could meet the team this year?',
            ],
            search_query: 'university recruiter Microsoft early career',
          },
        ],
      },
      {
        label: 'Founders in your space',
        why: 'Founders reply to students with real projects and give honest feedback.',
        connections: [
          {
            title: 'Founder of a student-built startup',
            organization: 'Local startup community',
            why: 'Has gone from side project to company while in school.',
            talking_points: [
              'How did you balance classes with building your first product?',
              'What would you do differently in your first year?',
            ],
            search_query: 'founder startup student Seattle',
          },
          {
            title: 'Angel investor / startup mentor',
            organization: 'University entrepreneurship center',
            why: 'Can connect you with programs, competitions, and other founders.',
            talking_points: [
              'Which campus competitions or accelerators are worth applying to?',
              'What do you look for in student founders?',
            ],
            search_query: 'mentor entrepreneurship center University of Washington',
          },
        ],
      },
    ],
  };
}
