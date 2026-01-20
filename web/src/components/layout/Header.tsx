"use client";

import { useState } from "react";
import {
  Bell,
  Moon,
  Sun,
  ChevronDown,
  LogOut,
  Settings,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mockNotifications } from "@/data/mock";

type AvailabilityMode = "available" | "away" | "dnd";

const availabilityLabels: Record<AvailabilityMode, string> = {
  available: "Available",
  away: "Away",
  dnd: "Do Not Disturb",
};

const availabilityColors: Record<AvailabilityMode, string> = {
  available: "bg-green-500",
  away: "bg-yellow-500",
  dnd: "bg-red-500",
};

export function Header() {
  const [availability, setAvailability] = useState<AvailabilityMode>("available");
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showAvailability, setShowAvailability] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  const unreadCount = mockNotifications.filter((n) => !n.read).length;

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 sm:px-6 lg:px-8">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-gray-900 hidden sm:block">
          Dashboard
        </h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {/* Dark mode toggle */}
        <button
          onClick={() => setDarkMode(!darkMode)}
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          aria-label="Toggle dark mode"
        >
          {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        {/* Availability dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowAvailability(!showAvailability)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                availabilityColors[availability]
              )}
            />
            <span className="hidden sm:inline">{availabilityLabels[availability]}</span>
            <ChevronDown className="h-4 w-4" />
          </button>

          {showAvailability && (
            <div className="absolute right-0 mt-2 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {(Object.keys(availabilityLabels) as AvailabilityMode[]).map(
                (mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setAvailability(mode);
                      setShowAvailability(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50",
                      availability === mode && "bg-gray-50"
                    )}
                  >
                    <span
                      className={cn(
                        "h-2.5 w-2.5 rounded-full",
                        availabilityColors[mode]
                      )}
                    />
                    {availabilityLabels[mode]}
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-medium text-white">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 rounded-lg border border-gray-200 bg-white shadow-lg">
              <div className="border-b border-gray-200 px-4 py-3">
                <h3 className="font-semibold text-gray-900">Notifications</h3>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {mockNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={cn(
                      "border-b border-gray-100 px-4 py-3 hover:bg-gray-50 cursor-pointer",
                      !notification.read && "bg-blue-50/50"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "mt-1 h-2 w-2 rounded-full flex-shrink-0",
                          notification.level === "critical" && "bg-red-500",
                          notification.level === "needs_input" && "bg-yellow-500",
                          notification.level === "info" && "bg-blue-500"
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {notification.title}
                        </p>
                        <p className="text-sm text-gray-500 truncate">
                          {notification.message}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-200 px-4 py-2">
                <button className="text-sm font-medium text-blue-600 hover:text-blue-700">
                  View all notifications
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-100 transition-colors"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white font-medium">
              G
            </div>
            <span className="hidden sm:inline text-sm font-medium text-gray-700">
              Ganesh
            </span>
            <ChevronDown className="h-4 w-4 text-gray-500" />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 mt-2 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              <button className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                <User className="h-4 w-4" />
                Profile
              </button>
              <button className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                <Settings className="h-4 w-4" />
                Settings
              </button>
              <hr className="my-1" />
              <button className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-gray-50">
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
