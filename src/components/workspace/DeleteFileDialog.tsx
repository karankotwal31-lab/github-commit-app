import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { WorkspaceViewProps } from "./types";
import { Loader2 } from "lucide-react";

type DeleteFileDialogProps = Pick<
  WorkspaceViewProps,
  | "deleteOpen"
  | "setDeleteOpen"
  | "deleting"
  | "handleDelete"
  | "openFile"
  | "currentBranch"
>;

/** Delete confirmation — commits a deletion on the current branch. */
export function DeleteFileDialog(props: DeleteFileDialogProps) {
  const { deleteOpen, setDeleteOpen, deleting, handleDelete, openFile, currentBranch } =
    props;

  return (
    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {openFile?.path}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This commits a deletion on {currentBranch}. It can always be
            restored from Git history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleting}
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {deleting && <Loader2 className="size-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
