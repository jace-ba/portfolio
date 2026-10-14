export interface Equation {
  tex: string;
  /** Matches the segments of the same color on the figure. */
  color?: 'red' | 'gold';
}

export interface Step {
  text?: string;
  equations: Equation[];
}

export const setup =
  'The marked segments are congruent, and the small circle is tangent at the marked points.';

/** Revealed one at a time. Step 1 labels the figure, step 2 adds the red relation, step 3 the gold one. */
export const steps: Step[] = [
  {
    text: 'The quarter circle has radius 1, each marked segment has length x, and the small circle has radius r.',
    equations: [],
  },
  {
    equations: [{ tex: String.raw`\sqrt{x^2+r^2} + r = 1`, color: 'red' }],
  },
  {
    equations: [{ tex: String.raw`\frac{\sqrt{4r^2-x^2}}{x}=\frac{x}{1}`, color: 'gold' }],
  },
  {
    equations: [
      {
        tex: String.raw`\begin{aligned}
          1-r &= \sqrt{x^2+r^2} \\
          r^2-2r+1 &= x^2+r^2 \\
          1-2r &= x^2
        \end{aligned}`,
        color: 'red',
      },
      { tex: String.raw`\sqrt{4r^2-x^2} = x^2`, color: 'gold' },
    ],
  },
  {
    equations: [
      {
        tex: String.raw`\begin{aligned}\begin{cases} 1-2r &= x^2 \\ \sqrt{4r^2-x^2} &= x^2 \end{cases} \quad\Rightarrow \\ \\ \\  \end{aligned}
          \quad\begin{aligned}
          \sqrt{4r^2-(1-2r)} &= 1-2r \\
          4r^2+2r-1 &= 4r^2-4r+1 \\
          6r &= 2 \\
          r &= \frac{1}{3}
        \end{aligned}`,
      },
    ],
  },
  {
    equations: [{ tex: String.raw`\text{ans} = \frac{\pi r^2}{\frac{1}{4}\pi} = 4r^2 = \boxed{\frac{4}{9}}` }],
  },
];
