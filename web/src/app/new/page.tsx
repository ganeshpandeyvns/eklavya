"use client";

import { ChatInterface } from "@/components/chat/ChatInterface";

export default function NewProjectPage() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col p-4 sm:p-6 lg:p-8">
      <div className="mb-4">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
          Create New Project
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Describe your project in plain English. Eklavya will ask clarifying questions.
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <ChatInterface />
      </div>
    </div>
  );
}
