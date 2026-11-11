package com.acme.security;

// Checks the X-Probaline-Identity header on a Spring Boot API (a servlet filter).
//
// Only calls that came through Probaline carry a valid one: a five-minute ES256 token naming who asked.
// Not yet tested in Probaline's CI; the Node and Python versions are.
//
// Needs spring-security-oauth2-jose (for NimbusJwtDecoder). Register it:
//   @Bean FilterRegistrationBean<ProbalineIdentityFilter> probaline() {
//     return new FilterRegistrationBean<>(new ProbalineIdentityFilter(
//         "https://gateway.acme.example", "https://hr.acme.example/api", false));
//   }
// In a controller: Jwt who = (Jwt) request.getAttribute(ProbalineIdentityFilter.ATTRIBUTE);

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.logging.Logger;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.web.filter.OncePerRequestFilter;

public class ProbalineIdentityFilter extends OncePerRequestFilter {
  public static final String HEADER = "X-Probaline-Identity";
  public static final String ATTRIBUTE = "probaline.identity";
  private static final Logger LOG = Logger.getLogger("probaline");

  private final NimbusJwtDecoder decoder;
  private final boolean reportOnly;

  public ProbalineIdentityFilter(String issuer, String audience, boolean reportOnly) {
    String iss = issuer.replaceAll("/+$", "");
    String aud = audience.replaceAll("/+$", "");
    this.reportOnly = reportOnly;
    // Only ES256, and only tokens typed as Probaline identity statements.
    this.decoder = NimbusJwtDecoder.withJwkSetUri(iss + "/.well-known/jwks.json")
        .jwsAlgorithm(SignatureAlgorithm.ES256)
        .jwtProcessorCustomizer(p -> p.setJWSTypeVerifier(
            new com.nimbusds.jose.proc.DefaultJOSEObjectTypeVerifier<>(new com.nimbusds.jose.JOSEObjectType("probaline-identity+jwt"))))
        .build();
    OAuth2TokenValidator<Jwt> issuerAndAudience = jwt -> {
      boolean issOk = jwt.getIssuer() != null && jwt.getIssuer().toString().replaceAll("/+$", "").equals(iss);
      boolean audOk = jwt.getAudience().stream().map(a -> a.replaceAll("/+$", "")).anyMatch(aud::equals);
      return issOk && audOk ? OAuth2TokenValidatorResult.success()
          : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", issOk ? "wrong_audience" : "wrong_issuer", null));
    };
    this.decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
        List.of(new JwtTimestampValidator(Duration.ofSeconds(30)), issuerAndAudience)));
  }

  @Override
  protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
      throws ServletException, IOException {
    String token = req.getHeader(HEADER);
    try {
      if (token == null || token.isBlank()) throw new JwtException("missing: no X-Probaline-Identity header");
      req.setAttribute(ATTRIBUTE, decoder.decode(token));
    } catch (JwtException e) {
      LOG.warning("Call without a valid Probaline identity: " + e.getMessage() + " " + req.getMethod() + " " + req.getRequestURI());
      if (!reportOnly) {
        res.setStatus(401);
        res.setHeader("WWW-Authenticate", "Probaline-Identity");
        res.setContentType("application/json");
        res.getWriter().write("{\"error\":\"The call didn't come through Probaline\"}");
        return;
      }
    }
    chain.doFilter(req, res);
  }
}
