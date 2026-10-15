import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

export const accents = ['azure', 'scarlet', 'tangerine', 'gold'] as const;

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    /** Shown as the accent-colored tag. */
    category: z.string(),
    /** Shown as the neutral tag. */
    stack: z.string(),
    accent: z.enum(accents),
    /** Optional so small builds with no single date can leave it out. */
    year: z.number().int().optional(),
    /** With a start year, the line reads "2025–now" instead of a single year. */
    ongoing: z.boolean().default(false),
    /** Lower comes first. */
    order: z.number().int().default(100),
    featured: z.boolean().default(false),
    /** `project` gets a detail page; `small` is a single card on the Projects page. */
    kind: z.enum(['project', 'small']).default('project'),
    /** External link for a small build. */
    href: z.url().optional(),
    /** PDFs and other files linked from the project page. */
    documents: z
      .array(
        z.object({
          label: z.string(),
          href: z.string().startsWith('/'),
          /** First-page image shown above the link. */
          preview: z
            .object({
              src: z.string().startsWith('/'),
              alt: z.string(),
              width: z.number().int().positive(),
              height: z.number().int().positive(),
            })
            .optional(),
        }),
      )
      .optional(),
  }).refine((project) => !project.ongoing || project.year != null, {
    message: 'An ongoing project needs a start year',
  }),
});

export const collections = { projects };
