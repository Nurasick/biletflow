import { useTranslation } from "react-i18next";
export const SocialLogin = () => {
  const { t } = useTranslation();
  return (
    <>
      <div className="my-5 flex items-center gap-3 font-mono text-[9.5px] text-[#667085]">
        <span className="h-px flex-1 bg-[#D0D5DD]" /> {t("auth.orContinue")}
        <span className="h-px flex-1 bg-[#D0D5DD]" />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {[
          ["G", "Google"],
          ["A", "Apple"],
        ].map(([mark, provider]) => (
          <button
            key={provider}
            type="button"
            disabled
            title={t("auth.providerUnavailable", { provider })}
            className="flex h-[43px] items-center justify-center rounded-[9px] border border-[#D0D5DD] bg-[#F5F5F0] text-[11.5px] font-semibold transition hover:border-[#98A2B3] hover:bg-white"
          >
            <span className="mr-2 grid h-[19px] w-[19px] place-items-center rounded-full bg-white font-bold">
              {mark}
            </span>
            {t("auth.providerSoon", { provider })}
          </button>
        ))}
      </div>

      <p className="mt-6 text-center text-[9.5px] leading-4 text-[#667085]">
        {t("auth.continueTerms")}
      </p>
    </>
  );
};
