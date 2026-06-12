export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8 font-sans">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        FB_EVENTOS
      </h1>
      <p className="text-base text-zinc-600 dark:text-zinc-400 max-w-prose text-center">
        Phase 0 scaffold — Next.js 15 + TypeScript strict + Tailwind 4.
        Domain code lands in later plans; this page just confirms the build
        boots locally and inside Docker.
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        See <code className="font-mono">.planning/ROADMAP.md</code> for what
        ships next.
      </p>
    </main>
  )
}
