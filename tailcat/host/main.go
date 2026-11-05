// dsh-tailcat-host is the Tailcat helper spawned by the DSH Anywhere host plugin.
// Protocol: docs/TAILCAT.md ("Helper IPC").
package main

import "os"

func main() {
	if err := Run(os.Stdin, os.Stdout, Option{}); err != nil {
		os.Exit(1)
	}
}
