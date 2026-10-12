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
    /** Lower comes first. */
    order: z.number().int().default(100),
    featured: z.boolean().default(false),
    /** `project` gets a detail page; `small` is a single card on the Projects page. */
    kind: z.enum(['project', 'small']).default('project'),
    /** External link for a small build. */
    href: z.url().optional(),
  }),
});

export const collections = { projects };
