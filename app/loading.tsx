export default function RootLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-ink-200 border-t-ink dark:border-ink-700 dark:border-t-paper"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
