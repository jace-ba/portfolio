export interface Quote {
  text: string;
  author: string;
  /** Where the quote first appeared. Required: physics quotes are often misattributed. */
  source: string;
}

/** One quote per week, in order. Append to extend; 52 entries is a year with no repeats. */
export const quotes: Quote[] = [
  {
    text: 'If you wish to make an apple pie from scratch, you must first invent the universe.',
    author: 'Carl Sagan',
    source: 'Cosmos (1980)',
  },
  {
    text: 'What I cannot create, I do not understand.',
    author: 'Richard Feynman',
    source: 'His Caltech blackboard (1988)',
  },
  {
    text: 'The question of whether a computer can think is no more interesting than the question of whether a submarine can swim.',
    author: 'Edsger W. Dijkstra',
    source: 'The threats to computing science, EWD898 (1984)',
  },
  {
    text: 'In the beginning the Universe was created. This has made a lot of people very angry and been widely regarded as a bad move.',
    author: 'Douglas Adams',
    source: 'The Restaurant at the End of the Universe (1980)',
  },
  {
    text: 'The purpose of computing is insight, not numbers.',
    author: 'Richard Hamming',
    source: 'Numerical Methods for Scientists and Engineers (1962)',
  },
  {
    text: 'Programs must be written for people to read, and only incidentally for machines to execute.',
    author: 'Harold Abelson and Gerald Jay Sussman',
    source: 'Structure and Interpretation of Computer Programs (1985)',
  },
  {
    text: 'Everyone knows that debugging is twice as hard as writing a program in the first place. So if you\u2019re as clever as you can be when you write it, how will you ever debug it?',
    author: 'Brian Kernighan and P. J. Plauger',
    source: 'The Elements of Programming Style, 2nd ed. (1978)',
  },
  {
    text: 'The first principle is that you must not fool yourself\u2014and you are the easiest person to fool.',
    author: 'Richard Feynman',
    source: 'Cargo Cult Science, Caltech commencement address (1974)',
  },
  {
    text: 'Premature optimization is the root of all evil.',
    author: 'Donald Knuth',
    source: 'Structured Programming with go to Statements (1974)',
  },
  {
    text: 'We are a way for the cosmos to know itself.',
    author: 'Carl Sagan',
    source: 'Cosmos (1980)',
  },
];

const WEEK_MS = 7 * 86_400_000;
/** 1970-01-05 was a Monday, so weeks roll over on Monday in the visitor's time zone. */
const FIRST_MONDAY = Date.UTC(1970, 0, 5);

/** Counts whole weeks rather than ISO week numbers, so the rotation never resets at New Year. */
export function quoteIndexFor(date: Date): number {
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const week = Math.floor((day - FIRST_MONDAY) / WEEK_MS);
  return week % quotes.length;
}
