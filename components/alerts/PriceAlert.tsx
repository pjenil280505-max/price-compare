"use client";

import { useEffect, useId, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import type { PriceAlertConfig } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

export interface PriceAlertButtonProps {
  productTitle: string;
  currentPrice: number;
  existingAlert?: PriceAlertConfig | null;
  onSave: (targetPrice: number) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  className?: string;
}

export function PriceAlertButton({
  productTitle,
  currentPrice,
  existingAlert,
  onSave,
  onDelete,
  className,
}: PriceAlertButtonProps) {
  const [open, setOpen] = useState(false);
  const [targetPrice, setTargetPrice] = useState(
    existingAlert?.targetPrice ?? Math.round(currentPrice * 0.9),
  );
  const [isSaving, setIsSaving] = useState(false);
  const inputId = useId();

  // Re-seed the draft from the latest props every time the modal opens, so a
  // reused component instance (e.g. a list item React didn't remount) never
  // shows a stale target price from whatever it last rendered.
  useEffect(() => {
    if (open) {
      setTargetPrice(existingAlert?.targetPrice ?? Math.round(currentPrice * 0.9));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isActive = Boolean(existingAlert?.active);
  const isAboveCurrent = targetPrice >= currentPrice;

  async function handleSave() {
    setIsSaving(true);
    try {
      await onSave(targetPrice);
      setOpen(false);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Button
        variant={isActive ? "secondary" : "outline"}
        size="md"
        leftIcon={
          isActive ? (
            <BellRing className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Bell className="h-4 w-4" aria-hidden="true" />
          )
        }
        onClick={() => setOpen(true)}
        className={className}
      >
        {isActive ? `Alert at ${formatPrice(existingAlert!.targetPrice)}` : "Set price alert"}
      </Button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Set a price alert"
        description={`We'll email you the moment ${productTitle} drops to your target price.`}
        variant="sheet"
        footer={
          <div className="flex items-center gap-2">
            {existingAlert && onDelete && (
              <Button variant="ghost" size="md" onClick={onDelete} className="mr-auto text-vermilion-600">
                Remove alert
              </Button>
            )}
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="md" isLoading={isSaving} onClick={handleSave}>
              Save alert
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-500 dark:text-ink-300">
            Current price: <span className="font-tabular font-semibold">{formatPrice(currentPrice)}</span>
          </p>
          <Input
            id={inputId}
            label="Notify me when the price drops to"
            type="number"
            min={1}
            value={targetPrice}
            onChange={(e) => setTargetPrice(Number(e.target.value))}
          />
          {isAboveCurrent && (
            <p className="text-sm text-saffron-600 dark:text-saffron-400">
              That&apos;s at or above the current price — you&apos;ll be notified right away.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
