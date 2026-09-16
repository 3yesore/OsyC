<script lang="ts">
    import { setIcon } from "@/deps.ts";

    interface Props {
        /** Obsidian built-in icon name (lucide naming). */
        name: string;
        /** Rendered edge length in pixels. */
        size?: number;
        /** Extra class names for local adjustments by the caller. */
        class?: string;
    }

    let { name, size = 16, class: className = "" }: Props = $props();

    let hostEl = $state<HTMLSpanElement | undefined>();

    // setIcon appends, so re-rendering the same node would stack duplicates.
    // replaceChildren is used instead of Obsidian's empty() to keep this
    // component independent of the host DOM patches.
    $effect(() => {
        const element = hostEl;
        const iconName = name;
        if (!element || !iconName) return;
        element.replaceChildren();
        setIcon(element, iconName);
    });

    // Obsidian sizes .svg-icon from its own variables; a local custom property
    // lets the caller decide, including for icons inside the icon buttons.
    let hostStyle = $derived(`--osyc-icon-size: ${size}px;`);
</script>

<span
    bind:this={hostEl}
    class="osyc-icon {className}"
    style={hostStyle}
    aria-hidden="true"
></span>

<style>
    .osyc-icon {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        width: var(--osyc-icon-size, 16px);
        height: var(--osyc-icon-size, 16px);
    }
    .osyc-icon :global(svg) {
        width: 100%;
        height: 100%;
    }
</style>
