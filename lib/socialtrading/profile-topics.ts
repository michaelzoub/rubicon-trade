import { CATEGORIES } from "./onboarding";
import { TOPICS } from "./topics";

/**
 * What onboarding needs to know about a topic, kept out of `topics.ts` so the
 * discovery catalog does not become an onboarding file.
 *
 * `claim` is the proposition Jev scores the evidence against — it is never
 * shown to anyone. `claims` is what we put on screen, four statements at
 * rising depth indexed by knowledge level, exactly like `QUESTIONS` in
 * `onboarding.ts`. `importance` is a static prior for how much the topic
 * shapes a portfolio, so a topic cannot win a question on uncertainty alone.
 */
export type TopicId = (typeof TOPICS)[number]["id"];

export type ProbeTopic = {
  id: TopicId;
  /** One of CATEGORIES, so domain coverage stays legible in an adaptive profile. */
  category: string;
  claim: string;
  claims: readonly [string, string, string, string];
  /** 0–1. */
  importance: number;
  /** True where choosing places says more than agreeing with a sentence. */
  geographic: boolean;
};

const [TECHNOLOGY, ENERGY, MONEY, HEALTH, GOVERNMENT, CLIMATE, SOCIETY] = CATEGORIES;

export const PROBE_TOPICS: readonly ProbeTopic[] = [
  {
    id: "semiconductors", category: TECHNOLOGY, importance: 0.95, geographic: false,
    claim: "This person expects the chips that run AI to stay the scarcest, most valuable part of the stack.",
    claims: [
      "The companies making AI chips keep most of the profit.",
      "Chip supply, not software, decides how fast AI spreads.",
      "Chipmaking stays concentrated in a handful of firms for years.",
      "Custom silicon erodes the general-purpose chip margin before demand cools.",
    ],
  },
  {
    id: "data-centers", category: TECHNOLOGY, importance: 0.8, geographic: false,
    claim: "This person expects physical AI infrastructure — buildings, cooling, land — to be a durable constraint and a durable business.",
    claims: [
      "AI needs enormous new buildings, not just better software.",
      "Data centre capacity is booked out faster than it can be built.",
      "Where you can build a data centre matters more than who builds it.",
      "Today's data centre build-out overshoots the demand it is sized for.",
    ],
  },
  {
    id: "cloud-software", category: TECHNOLOGY, importance: 0.55, geographic: false,
    claim: "This person expects software businesses to capture the gains from AI rather than be commoditised by it.",
    claims: [
      "Software companies come out of the AI shift stronger.",
      "Selling software by the seat stops working as AI does the work.",
      "Incumbent software keeps its customers because switching is too costly.",
      "AI compresses software margins faster than it expands software markets.",
    ],
  },
  {
    id: "robotics", category: TECHNOLOGY, importance: 0.75, geographic: false,
    claim: "This person expects machines to take over physical work at scale, and sees that as investable.",
    claims: [
      "Robots take more physical jobs than they create.",
      "Factories and warehouses run with far fewer people.",
      "Robotics creates more value in factories than in homes.",
      "Robotics changes the physical economy more than AI changes office work.",
    ],
  },
  {
    id: "power-grid", category: ENERGY, importance: 0.9, geographic: false,
    claim: "This person expects electricity supply to become the binding constraint on growth.",
    claims: [
      "Electricity becomes harder to get than oil.",
      "New power cannot keep up with AI and electric everything.",
      "Power availability holds AI back more than computing chips do.",
      "Electricity infrastructure outlasts the current AI boom.",
    ],
  },
  {
    id: "digital-money", category: MONEY, importance: 0.7, geographic: false,
    claim: "This person expects crypto assets to hold value as a store of value rather than fade as speculation.",
    claims: [
      "Crypto is here to stay, not a passing craze.",
      "Bitcoin behaves more like gold than like a tech stock.",
      "Crypto succeeds mainly through systems people barely notice.",
      "Digital finance keeps blockchain even if most cryptocurrencies disappear.",
    ],
  },
  {
    id: "stablecoins", category: MONEY, importance: 0.65, geographic: false,
    claim: "This person expects dollar-pegged tokens to become ordinary payment infrastructure.",
    claims: [
      "Crypto becomes everyday money, not just something people trade.",
      "Stablecoins become a normal way to pay, even for people who dislike crypto.",
      "Stablecoins matter more for moving money between countries than inside one.",
      "Regulated stablecoins displace card networks before banks adopt them.",
    ],
  },
  {
    id: "decentralized-finance", category: MONEY, importance: 0.45, geographic: false,
    claim: "This person expects financial services to be rebuilt on open protocols rather than inside institutions.",
    claims: [
      "Financial services get rebuilt on open networks.",
      "People will borrow and lend without a bank in the middle.",
      "Open finance wins in the places banks serve worst, not the places they serve well.",
      "Regulated institutions absorb open finance rather than being replaced by it.",
    ],
  },
  {
    id: "biotech", category: HEALTH, importance: 0.7, geographic: false,
    claim: "This person expects biological breakthroughs to translate into long, investable trends.",
    claims: [
      "Living healthy into your nineties becomes normal.",
      "New drugs change how common diseases are treated, not just how they are managed.",
      "Ageing populations reshape who works more than they reshape healthcare.",
      "Healthcare innovation accelerates, but rules stop it spreading fast.",
    ],
  },
  {
    id: "medical-technology", category: HEALTH, importance: 0.5, geographic: false,
    claim: "This person expects devices, robotics and software to reshape care delivery rather than drugs alone.",
    claims: [
      "Machines do more of the work in hospitals.",
      "Caring for ageing populations costs more than any other public service.",
      "Care moves out of hospitals and into homes and devices.",
      "Reimbursement, not capability, sets how fast medical technology spreads.",
    ],
  },
  {
    id: "defence-sovereignty", category: GOVERNMENT, importance: 0.8, geographic: true,
    claim: "This person expects countries to prioritise self-sufficiency and security over cheap global supply.",
    claims: [
      "Countries make more of their own goods, even if it costs more.",
      "Governments spend more on defence and making things at home than on cheap imports.",
      "Energy security matters more to governments than cheap energy.",
      "Bringing production home costs more and takes longer than governments expect.",
    ],
  },
  {
    id: "climate-adaptation", category: CLIMATE, importance: 0.7, geographic: true,
    claim: "This person expects spending to shift from preventing climate damage to living with it.",
    claims: [
      "We spend more fixing climate damage than preventing it.",
      "Protecting cities from climate damage becomes as big as cutting emissions.",
      "Climate adaptation grows faster than spending to prevent climate change.",
      "Climate adaptation attracts more money than preventing climate change.",
    ],
  },
  {
    id: "ai-applications", category: SOCIETY, importance: 0.95, geographic: false,
    claim: "This person expects AI to change how work is done across the economy, not only inside technology.",
    claims: [
      "AI takes over more work than it creates.",
      "People who do not use AI at work fall behind.",
      "AI changes old industries more than it creates new ones.",
      "The world is overestimating AI's short-term impact and underestimating its long-term reach.",
    ],
  },
  {
    id: "future-of-work", category: SOCIETY, importance: 0.5, geographic: false,
    claim: "This person expects the shape of employment itself — who works, where, under what terms — to change materially.",
    claims: [
      "How people work changes more in ten years than in the last fifty.",
      "Fewer people do the same amount of work, for the same total pay.",
      "The gains from automation go to owners rather than workers.",
      "Labour shortages, not automation, drive the next decade of wage growth.",
    ],
  },
  {
    id: "consumer-trends", category: SOCIETY, importance: 0.35, geographic: false,
    claim: "This person expects changes in how people spend to be a driver worth investing behind.",
    claims: [
      "What people buy changes faster than what companies can make.",
      "Brands matter less than the platforms that sell them.",
      "Spending shifts from things to services and experiences.",
      "Consumer demand proves stickier than the headlines about it suggest.",
    ],
  },
];

const BY_ID = new Map(PROBE_TOPICS.map(topic => [topic.id as string, topic]));
const NAMES = new Map(TOPICS.map(topic => [topic.id as string, topic.name]));

export const probeTopic = (id: string): ProbeTopic | undefined => BY_ID.get(id);
export const topicName = (id: TopicId): string => NAMES.get(id) ?? id;
export const isTopicId = (value: unknown): value is TopicId => typeof value === "string" && BY_ID.has(value);
