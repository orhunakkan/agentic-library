import type { AppliesTo } from './prompts.ts'

export interface StarterPrompt {
  key: string
  name: string
  appliesTo: AppliesTo
  instruction: string
}

export const STARTER_PROMPTS: readonly StarterPrompt[] = [
  {
    key: 'explain-like-im-new',
    name: "Explain like I'm new",
    appliesTo: 'passage',
    instruction:
      "Explain this passage as if I'm completely new to the subject and to the book. Use everyday words, give one short example or comparison, and say what any technical term means the first time it comes up.",
  },
  {
    key: 'whos-who-so-far',
    name: "Who's who so far",
    appliesTo: 'pages',
    instruction:
      "List the people who have come up so far (or, in a non-fiction book, the main ideas and terms), each with one line on who or what they are and how they connect. Use only the pages I've read.",
  },
  {
    key: 'find-the-argument',
    name: 'Find the argument',
    appliesTo: 'passage',
    instruction:
      'What is this passage arguing or claiming? Give the main point in one sentence, then the reasons or evidence it gives, then any assumption it rests on.',
  },
  {
    key: 'questions-to-think-about',
    name: 'Questions to think about',
    appliesTo: 'pages',
    instruction:
      'Give me three open questions to think about from the chapter so far: questions with no single right answer, about the choices, ideas or themes in it.',
  },
]

export const starterKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
