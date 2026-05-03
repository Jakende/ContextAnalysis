declare module "plotly.js-dist-min" {
  type PlotlyElement = HTMLElement;

  const Plotly: {
    react: (
      root: PlotlyElement,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>,
    ) => Promise<PlotlyElement>;
    purge: (root: PlotlyElement) => void;
    Plots: {
      resize: (root: PlotlyElement) => Promise<void> | void;
    };
  };

  export default Plotly;
}
