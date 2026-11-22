import { toast } from "sonner";

// Notices for a projector: money results and errors stay until someone closes them (the X is on every notice);
// plain info goes away after 8 seconds.
const STAY = { duration: Infinity };
type Opts = { description?: string };

export const notify = {
  money: (msg: string, o: Opts = {}) => toast.success(msg, { ...STAY, ...o }),
  error: (msg: string, o: Opts = {}) => toast.error(msg, { ...STAY, ...o }),
  info: (msg: string, o: Opts = {}) => toast.success(msg, { duration: 8000, ...o }),
};
