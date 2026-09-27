<#--
  Execute-actions email: the activation email of a staff account (spec 01, user stories 21, 22
  and 25). The directory sets the account's `commissionName` and `invitedRole` attributes before
  it asks Keycloak to send this email; without them the email falls back to a generic
  "complete your account setup" message.
-->
<#import "template.ftl" as layout>
<#import "invitation.ftl" as invitation>
<#assign i = invitation.details()>
<#assign font = "font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<#-- Bold, escaped text to pass into an HTML message. -->
<#function strong text><#return "<strong style=\"font-weight:600;color:#0e1913;\">" + text?esc?markup_string + "</strong>"></#function>
<@layout.emailLayout preheader=i.preheader>
<#if i.invited>
<p style="margin:0 0 8px;font-size:13px;line-height:20px;font-weight:600;color:#07602f;">${msg("adiliInviteEyebrow")}</p>
<h1 style="margin:0 0 20px;${font}font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.015em;color:#0e1913;">${msg("adiliInviteTitle", i.roleTitle)}</h1>
<#else>
<h1 style="margin:0 0 20px;${font}font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.015em;color:#0e1913;">${msg("adiliSetupTitle")}</h1>
</#if>
<p style="margin:0 0 16px;">${i.greeting}</p>
<#if i.invited>
<p style="margin:0 0 16px;">${msg("adiliInviteLead", strong(i.roleTitle), strong(i.commission))?no_esc}</p>
<#if i.duty?has_content>
<p style="margin:0 0 24px;">${i.duty}</p>
</#if>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;background-color:#f1f5f1;border-radius:8px;">
  <tr>
    <td style="padding:16px 20px;${font}font-size:14px;line-height:22px;color:#0e1913;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td class="detail-label" width="112" style="padding:2px 12px 2px 0;vertical-align:top;${font}font-size:13px;line-height:22px;color:#525e57;">${msg("adiliDetailCommission")}</td>
          <td class="detail-value" style="padding:2px 0;vertical-align:top;${font}font-size:14px;line-height:22px;font-weight:600;color:#0e1913;">${i.commission}</td>
        </tr>
        <tr>
          <td class="detail-label" width="112" style="padding:2px 12px 2px 0;vertical-align:top;${font}font-size:13px;line-height:22px;color:#525e57;">${msg("adiliDetailRole")}</td>
          <td class="detail-value" style="padding:2px 0;vertical-align:top;${font}font-size:14px;line-height:22px;color:#0e1913;">${i.roleTitle?cap_first}</td>
        </tr>
        <#if user.email?has_content>
        <tr>
          <td class="detail-label" width="112" style="padding:2px 12px 2px 0;vertical-align:top;${font}font-size:13px;line-height:22px;color:#525e57;">${msg("adiliDetailEmail")}</td>
          <td class="detail-value" style="padding:2px 0;vertical-align:top;${font}font-size:14px;line-height:22px;color:#0e1913;overflow-wrap:anywhere;">${user.email}</td>
        </tr>
        </#if>
      </table>
    </td>
  </tr>
</table>
<#else>
<p style="margin:0 0 24px;">${msg("adiliSetupLead")}</p>
</#if>
<#if i.steps?has_content>
<p style="margin:0 0 12px;font-weight:600;">${msg(i.invited?then("adiliStepsIntro", "adiliStepsIntroSetup"))}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
  <#list i.steps as step>
  <tr>
    <td width="36" style="padding:0 0 14px;vertical-align:top;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center" width="24" height="24" style="width:24px;height:24px;border-radius:12px;background-color:#e0f5e5;${font}font-size:12px;line-height:24px;font-weight:600;color:#074a24;">${step?counter}</td>
        </tr>
      </table>
    </td>
    <td style="padding:1px 0 14px;vertical-align:top;${font}font-size:15px;line-height:22px;color:#0e1913;">
      <strong style="font-weight:600;">${step.title}</strong><#if step.detail?has_content><br><span style="color:#525e57;">${step.detail}</span></#if>
    </td>
  </tr>
  </#list>
</table>
</#if>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
  <tr>
    <td align="center" style="border-radius:8px;background-color:#07602f;">
      <a href="${link}" target="_blank" style="display:inline-block;padding:12px 24px;${font}font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${msg(i.invited?then("adiliInviteButton", "adiliSetupButton"))}</a>
    </td>
  </tr>
</table>
<p style="margin:0 0 16px;">${msg("adiliLinkExpiry", strong(i.expiry))?no_esc}<#if i.invited> ${msg("adiliLinkExpiredInvite")}<#else> ${msg("adiliLinkExpiredSetup")}</#if></p>
<p style="margin:0;padding-top:20px;border-top:1px solid #dee3de;font-size:13px;line-height:20px;color:#525e57;">${msg("adiliLinkFallback")}<br><a href="${link}" target="_blank" style="font-size:12px;line-height:18px;color:#07602f;word-break:break-all;">${link}</a></p>
</@layout.emailLayout>
