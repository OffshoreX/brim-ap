import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Bigger than the default so it reads from across a room: 16px text, 480px wide. The X sits top right (see styles.css).
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      closeButton
      style={{ "--width": "min(480px, calc(100vw - 32px))" } as React.CSSProperties}
      toastOptions={{
        closeButtonAriaLabel: "Close notice",
        classNames: {
          toast:
            "group toast group-[.toaster]:glass group-[.toaster]:text-foreground group-[.toaster]:rounded-xl group-[.toaster]:!text-base group-[.toaster]:!p-4 group-[.toaster]:!pr-12",
          title: "!text-base !font-semibold",
          description: "group-[.toast]:text-muted-foreground !text-base",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
