"use client";

import { Sun, Moon, CloudSun } from "lucide-react";

interface WelcomeMessageProps {
  name: string;
  summary?: {
    demosReady: number;
    buildsComplete: number;
    totalSpent: number;
  };
}

function getGreeting(): { text: string; icon: typeof Sun } {
  const hour = new Date().getHours();
  if (hour < 12) return { text: "Good morning", icon: Sun };
  if (hour < 17) return { text: "Good afternoon", icon: CloudSun };
  return { text: "Good evening", icon: Moon };
}

export function WelcomeMessage({ name, summary }: WelcomeMessageProps) {
  const greeting = getGreeting();
  const GreetingIcon = greeting.icon;

  return (
    <div className="rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 p-4 sm:p-6 text-white shadow-lg">
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-white/20 flex-shrink-0">
          <GreetingIcon className="h-5 w-5 sm:h-6 sm:w-6" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg sm:text-xl font-bold">
            {greeting.text}, {name}!
          </h2>
          {summary && (
            <div className="mt-2 sm:mt-3 space-y-1 text-sm sm:text-base text-white/90">
              {summary.demosReady > 0 && (
                <p>
                  <span className="font-semibold text-yellow-300">
                    {summary.demosReady} demo{summary.demosReady > 1 ? "s" : ""}
                  </span>{" "}
                  ready for your review
                </p>
              )}
              {summary.buildsComplete > 0 && (
                <p>
                  <span className="font-semibold text-green-300">
                    {summary.buildsComplete} build{summary.buildsComplete > 1 ? "s" : ""}
                  </span>{" "}
                  completed
                </p>
              )}
              <p>
                <span className="font-semibold">${summary.totalSpent.toFixed(2)}</span>{" "}
                spent today across all projects
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
