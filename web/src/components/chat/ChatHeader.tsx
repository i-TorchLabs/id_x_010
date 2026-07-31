"use client";

interface ChatHeaderProps {
  onClearChat: () => void;
}

export function ChatHeader({ onClearChat }: ChatHeaderProps) {
  return (
    <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-xl border-b border-gray-200/50">
      <div className="max-w-3xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
              <svg
                className="w-5 h-5 text-white"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
              >
                <path d="M10 2L3 7v11h4v-6h6v6h4V7l-7-5z" />
              </svg>
            </div>
            <div>
              <h1 className="text-[17px] font-semibold leading-[1.24] tracking-[-0.374px] text-(--color-near-black)]">
                AI Assistant
              </h1>
              <p className="text-[12px] leading-[1.33] tracking-[-0.12px] text-[rgba(0,0,0,0.6)]">
                Chat · Apple Style
              </p>
            </div>
          </div>
          <button
            onClick={onClearChat}
            className="px-3 py-1.5 text-[14px] leading-[1.29] tracking-[-0.224px] text-(--color-link-blue) hover:text-(--color-apple-blue) rounded-md hover:bg-gray-50 transition-colors"
          >
            Clear Chat
          </button>
        </div>
      </div>
    </div>
  );
}
