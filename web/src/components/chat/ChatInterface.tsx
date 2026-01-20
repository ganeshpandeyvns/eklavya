"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const initialMessages: Message[] = [
  {
    id: "1",
    role: "assistant",
    content:
      "Hi! I'm Eklavya, your development partner. Tell me about the project you want to build. What kind of app or website do you have in mind?",
    timestamp: new Date(),
  },
];

const quickStarters = [
  "I need an e-commerce website",
  "Build me a SaaS dashboard",
  "Create a mobile app landing page",
  "I have an existing project to import",
];

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const simulateResponse = (userMessage: string) => {
    setIsTyping(true);

    // Simulate thinking time based on message length
    const baseDelay = 1000 + Math.min(userMessage.length * 10, 500);
    setTimeout(() => {
      const responses = [
        `That sounds like a great project! Let me understand better:\n\n1. Who is your target audience for this?\n2. What are the 3 most important features?\n3. Do you have any design preferences or brand guidelines?`,
        `Interesting! I'd love to help you build this. A few quick questions:\n\n• What's the primary goal of this project?\n• Any specific technologies you'd like to use?\n• What's your timeline looking like?`,
        `Perfect, I can definitely help with that. Before I start planning:\n\n1. Is this for a specific client?\n2. What budget range are we working with?\n3. Any existing systems this needs to integrate with?`,
      ];

      const response = responses[Math.floor(Math.random() * responses.length)];

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: response,
          timestamp: new Date(),
        },
      ]);
      setIsTyping(false);
    }, baseDelay);
  };

  const handleSend = () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    simulateResponse(input.trim());

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickStart = (text: string) => {
    setInput(text);
    inputRef.current?.focus();
  };

  const adjustTextareaHeight = () => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(
        inputRef.current.scrollHeight,
        150
      )}px`;
    }
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 sm:px-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-purple-600">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900">New Project</h2>
          <p className="text-sm text-gray-500">Describe what you want to build</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex",
              message.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3",
                message.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-900"
              )}
            >
              <p className="text-sm sm:text-base whitespace-pre-wrap">
                {message.content}
              </p>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl px-4 py-3">
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick starters */}
      {messages.length === 1 && (
        <div className="px-4 pb-3 sm:px-6">
          <p className="text-xs text-gray-500 mb-2">Quick starters:</p>
          <div className="flex flex-wrap gap-2">
            {quickStarters.map((starter) => (
              <button
                key={starter}
                onClick={() => handleQuickStart(starter)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
              >
                {starter}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-gray-200 p-3 sm:p-4">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              adjustTextareaHeight();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Describe your project..."
            className="flex-1 resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm sm:text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[48px] max-h-[150px]"
            rows={1}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-xl transition-colors",
              input.trim() && !isTyping
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-100 text-gray-400"
            )}
          >
            {isTyping ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
