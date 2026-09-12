type AuthHeadingProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export const AuthHeading = ({ eyebrow, title, description }: AuthHeadingProps) => (
  <>
    <p className="font-mono text-[10px] font-semibold tracking-[0.13em] text-[#FF5C35]">
      {eyebrow}
    </p>
    <h2 className="mt-2.5 text-[29px] font-bold leading-[1.15] tracking-[-0.035em]">
      {title}
    </h2>
    <p className="mt-2 text-[12.5px] leading-[1.55] text-[#667085]">
      {description}
    </p>
  </>
);
