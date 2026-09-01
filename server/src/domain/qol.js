/**
 * Quality of life assessment.
 *
 * Eight areas, each scored 0–5, giving a total out of 40. The structure
 * follows the JOURNEYS framework used widely in veterinary palliative
 * care; the descriptive wording here is our own.
 *
 * WHAT THIS IS FOR. Families facing this decision describe the same
 * thing: they can't tell whether today is bad or whether every day has
 * been bad for a while. Scoring the same eight areas each week turns an
 * impossible judgement into a visible trend.
 *
 * WHAT IT IS NOT. It does not decide anything, and it must never appear
 * to. A number cannot know an animal, and the result must always point
 * back to a vet who can examine the pet. Every band below says so.
 */

export const QOL_CATEGORIES = [
  {
    key: 'jumping',
    letter: 'J',
    title: 'Jumping and mobility',
    prompt: 'Getting up, walking, managing stairs, or needing help to move around.',
  },
  {
    key: 'ouch',
    letter: 'O',
    title: 'Ouch — pain',
    prompt: 'Signs of discomfort, and whether pain relief still seems to be working.',
  },
  {
    key: 'uncertainty',
    letter: 'U',
    title: 'Uncertainty',
    prompt: 'How well you understand what is happening, and whether you know what to expect next.',
  },
  {
    key: 'respiration',
    letter: 'R',
    title: 'Respiration — breathing',
    prompt: 'Breathing comfortably, or laboured, coughing, or struggling.',
  },
  {
    key: 'neatness',
    letter: 'N',
    title: 'Neatness — hygiene',
    prompt: 'Staying clean and dry, managing toileting, coat and skin condition.',
  },
  {
    key: 'eating',
    letter: 'E',
    title: 'Eating and drinking',
    prompt: 'Appetite, thirst, and whether they can eat and keep food down.',
  },
  {
    key: 'you',
    letter: 'Y',
    title: 'You',
    prompt: 'How you are coping — your own health, sleep, work, finances and family. '
      + 'This matters and belongs in the picture.',
  },
  {
    key: 'social',
    letter: 'S',
    title: 'Social ability',
    prompt: 'Interest in you, other pets, and the things they used to enjoy.',
  },
];

export const MAX_SCORE = QOL_CATEGORIES.length * 5; // 40

/**
 * What a total means, in plain language.
 *
 * Deliberately worded so that NO band tells anyone what to do. The lowest
 * says the picture is concerning and to speak to a vet soon; it does not
 * say "it's time", because that is not a thing software gets to say to
 * someone about their dog.
 */
export function interpretScore(total) {
  if (total >= 30) {
    return {
      band: 'good',
      headline: 'Things look reasonably comfortable at the moment.',
      // Even a good score points to a vet. A comfortable-looking total
      // can still sit alongside something a vet would want to know
      // about, and this is the band a worried owner is most likely to
      // take as permission to wait.
      body: 'Most areas are scoring well. It\'s worth repeating this every week or two — '
        + 'the trend over time tells you far more than any single score, and changes are '
        + 'easier to see written down than remembered. If anything worries you in the '
        + 'meantime, speak to your vet regardless of the number.',
    };
  }
  if (total >= 21) {
    return {
      band: 'watch',
      headline: 'Some areas are starting to slip.',
      body: 'This is a good moment to talk to your vet about what could be adjusted — pain '
        + 'relief, appetite, or making the house easier to move around. Small changes often '
        + 'help more than people expect at this stage.',
    };
  }
  if (total >= 13) {
    return {
      band: 'concern',
      headline: 'Several areas are causing real difficulty.',
      body: 'Please speak to your vet soon. There may still be things that can be done to make '
        + 'your pet more comfortable, and it is much better to have that conversation before '
        + 'you are in a crisis.',
    };
  }
  return {
    band: 'urgent',
    headline: 'This picture is concerning.',
    body: 'Please contact your vet as soon as you can, today if possible. They can examine your '
      + 'pet and talk you through the options properly — that is a conversation to have with a '
      + 'person who can see them, not a score.',
  };
}

/**
 * Total a set of answers.
 *
 * Returns null when anything is unanswered rather than a partial total:
 * a score of 18 out of a possible 40 means something very different from
 * 18 out of 25, and showing the first when the second is true would be
 * misleading at the worst possible moment.
 *
 * @param {Record<string, number>} answers keyed by category
 */
export function scoreAssessment(answers) {
  const scores = {};
  let complete = true;

  for (const cat of QOL_CATEGORIES) {
    const raw = answers?.[cat.key];
    const n = Number(raw);
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(n) || n < 0 || n > 5) {
      complete = false;
      continue;
    }
    scores[cat.key] = Math.round(n);
  }

  if (!complete) {
    return { complete: false, total: null, maxScore: MAX_SCORE, scores, interpretation: null };
  }

  const total = Object.values(scores).reduce((sum, n) => sum + n, 0);
  return {
    complete: true,
    total,
    maxScore: MAX_SCORE,
    scores,
    interpretation: interpretScore(total),
    // The individual areas scoring worst. A total of 24 made up of eight
    // 3s is a different situation from one where breathing scores 0, and
    // the second is the one a vet needs to hear about first.
    lowest: QOL_CATEGORIES
      .map((c) => ({ key: c.key, title: c.title, score: scores[c.key] }))
      .filter((c) => c.score <= 2)
      .sort((a, b) => a.score - b.score),
  };
}
